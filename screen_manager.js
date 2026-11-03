//screen_manager.js

import { TEST_INFO } from "./test_evaluators.js";

const TEST_ORDER = ["walkAndTurn", "oneLegStand", "romberg", "fingerToNose"];

export function createScreenManager({
  onStartAudio,
  onStartTest,
  onStopTest,
  onTestResult,
  onReset,
  speak,
  stopSpeaking,
}) {
  const screens = {
    title: document.getElementById("title-screen"),
    instructions: document.getElementById("instruction-screen"),
    active: document.getElementById("active-test-screen"),
    result: document.getElementById("result-screen"),
    final: document.getElementById("final-results-screen"),
  };

  const navigation = document.getElementById("test-navigation");
  const navButtons = navigation.querySelectorAll("[data-test]");

  const startButton = document.getElementById("start-button");
  const beginTestButton = document.getElementById("begin-test-button");
  const continueButton = document.getElementById("result-continue-button");
  const restartButton = document.getElementById("restart-button");

  const instructionTitle = document.getElementById("test-instruction-title");
  const instructionText = document.getElementById("test-instruction-text");

  const resultHeading = document.getElementById("test-result-heading");
  const resultScore = document.getElementById("test-result-score");
  const resultDetail = document.getElementById("test-result-detail");

  const overallHeading = document.getElementById("overall-result-heading");
  const overallMessage = document.getElementById("overall-result-message");
  const overallList = document.getElementById("overall-results-list");

  const modal = document.getElementById("app-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalMessage = document.getElementById("modal-message");
  const modalCancel = document.getElementById("modal-cancel-button");
  const modalConfirm = document.getElementById("modal-confirm-button");

  const COUNTDOWN_SECONDS = 5;
  const countdownStatus = document.getElementById("instruction-countdown");

  let currentTest = TEST_ORDER[0];
  let currentScreen = "title";
  let completedResults = {};
  let pendingTest = null;
  let transitionTimer = null;
  let transitionVersion = 0;

  function cancelTransition() {
    transitionVersion += 1;

    if (transitionTimer !== null) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
  }

  function showScreen(screenName) {
    currentScreen = screenName;

    for (const [name, element] of Object.entries(screens)) {
      element.hidden = name !== screenName;
    }

    navigation.hidden = screenName === "title" || screenName === "final";

    updateNavigation();
  }

  function updateNavigation() {
    for (const button of navButtons) {
      const testName = button.dataset.test;

      button.classList.toggle("current-test", testName === currentTest);

      if (completedResults[testName]) {
        button.setAttribute(
          "aria-label",
          `${TEST_INFO[testName].label}, completed`,
        );
      } else {
        button.setAttribute("aria-label", TEST_INFO[testName].label);
      }
    }
  }

  function scheduleAfterSpeech(text, pause, callback) {
    cancelTransition();

    const version = transitionVersion;
    let finished = false;

    const fallbackTime = Math.max(12000, text.length * 180);

    const fallbackTimer = setTimeout(finishSpeech, fallbackTime);

    function finishSpeech() {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(fallbackTimer);

      if (version !== transitionVersion) {
        return;
      }

      transitionTimer = setTimeout(() => {
        if (version === transitionVersion) {
          callback();
        }
      }, pause);
    }

    Promise.resolve(speak(text)).then(finishSpeech).catch(finishSpeech);
  }

  function runCountdown(seconds, callback) {
    cancelTransition();

    const version = transitionVersion;
    let remaining = seconds;

    function tick() {
      if (version !== transitionVersion) {
        return;
      }

      if (remaining <= 0) {
        callback();
        return;
      }

      countdownStatus.textContent = `Starting in ${remaining}`;
      remaining -= 1;
      transitionTimer = setTimeout(tick, 1000);
    }

    tick();
  }

  function showTitle() {
    cancelTransition();
    stopSpeaking();
    onStopTest();
    showScreen("title");
  }

  function showInstructions(testName) {
    if (!TEST_INFO[testName] || completedResults[testName]) {
      return;
    }

    cancelTransition();
    stopSpeaking();
    onStopTest();

    currentTest = testName;

    instructionTitle.textContent = TEST_INFO[testName].label;
    instructionText.textContent = TEST_INFO[testName].instructions;

    showScreen("instructions");

    countdownStatus.textContent = "Listen to the instructions";

    scheduleAfterSpeech(TEST_INFO[testName].instructions, 500, () =>
      runCountdown(COUNTDOWN_SECONDS, startActiveTest),
    );
  }

  function startActiveTest() {
    if (completedResults[currentTest]) {
      showLockedModal(currentTest);
      return;
    }

    cancelTransition();
    stopSpeaking();

    showScreen("active");
    onStartTest(currentTest);
  }

  function showTestResult(testName, result) {
    if (completedResults[testName]) {
      return;
    }

    completedResults[testName] = result;

    cancelTransition();
    stopSpeaking();
    onStopTest();
    onTestResult(result);

    resultHeading.textContent = result.result;
    resultHeading.className = result.result === "PASS" ? "pass" : "fail";

    resultScore.textContent = `Movement completion score: ${result.scorePercent}%. Score shortfall: ${result.failPercent}%.`;

    resultDetail.textContent = result.detail;

    showScreen("result");

    const spokenResult =
      `${TEST_INFO[testName].label}. ${result.result === "PASS" ? "You passed this test." : "You did not pass this test."} ` +
      `Your movement completion score was ${result.scorePercent} percent.`;

    scheduleAfterSpeech(spokenResult, 2500, advanceToNextTest);

    console.table(completedResults);
  }

  function advanceToNextTest() {
    cancelTransition();

    const nextTest = TEST_ORDER.find((testName) => !completedResults[testName]);

    if (!nextTest) {
      showFinalResults();
      return;
    }

    showInstructions(nextTest);
  }

  function showFinalResults() {
    cancelTransition();
    stopSpeaking();
    onStopTest();

    const allTestsPassed = TEST_ORDER.every(
      (testName) => completedResults[testName]?.result === "PASS",
    );

    overallHeading.textContent = allTestsPassed
      ? "OVERALL PASS"
      : "OVERALL FAIL";
    overallHeading.className = allTestsPassed ? "pass" : "fail";

    overallMessage.textContent = allTestsPassed
      ? "You passed all four individual tests."
      : "You did not pass all four individual tests. Review the results below.";

    overallList.replaceChildren();

    for (const testName of TEST_ORDER) {
      const result = completedResults[testName];
      const item = document.createElement("li");
      const label = document.createElement("span");
      const score = document.createElement("span");

      label.textContent = TEST_INFO[testName].label;
      score.textContent = `${result.result} — ${result.scorePercent}%`;
      score.className =
        result.result === "PASS" ? "result-pass" : "result-fail";

      item.append(label, score);
      overallList.appendChild(item);
    }

    showScreen("final");

    const spokenSummary = allTestsPassed
      ? "Assessment complete. Overall pass. You passed all four tests."
      : "Assessment complete. Overall fail. You did not pass all four tests.";

    Promise.resolve(speak(spokenSummary)).catch((error) => {
      console.warn("Unable to speak the final results:", error);
    });
  }

  function closeModal() {
    modal.hidden = true;
    pendingTest = null;
  }

  function openSwitchModal(testName) {
    cancelTransition();
    stopSpeaking();

    pendingTest = testName;

    modalTitle.textContent = "Switch tests?";
    modalMessage.textContent = `Are you sure you want to switch from ${TEST_INFO[currentTest].label} to ${TEST_INFO[testName].label}? Your current unfinished test will not be recorded.`;

    modalCancel.textContent = "STAY";
    modalConfirm.textContent = "SWITCH TEST";
    modalConfirm.hidden = false;

    modal.hidden = false;
    modalCancel.focus();
  }

  function showLockedModal(testName) {
    cancelTransition();
    stopSpeaking();

    pendingTest = null;

    modalTitle.textContent = "Test already completed";
    modalMessage.textContent = `${TEST_INFO[testName].label} has already been completed. You cannot retry an individual test. Finish the full assessment and restart to try again.`;

    modalCancel.textContent = "CLOSE";
    modalConfirm.hidden = true;

    modal.hidden = false;
    modalCancel.focus();
  }

  function requestTest(testName) {
    if (!TEST_INFO[testName]) {
      return;
    }

    if (completedResults[testName]) {
      showLockedModal(testName);
      return;
    }

    if (testName === currentTest) {
      return;
    }

    openSwitchModal(testName);
  }

  function confirmSwitch() {
    if (!pendingTest) {
      return;
    }

    const nextTest = pendingTest;

    closeModal();
    showInstructions(nextTest);
  }

  function restartAssessment() {
    cancelTransition();
    stopSpeaking();
    onStopTest();

    completedResults = {};
    currentTest = TEST_ORDER[0];

    closeModal();
    onReset();

    showTitle();
  }

  startButton.addEventListener("click", () => {
    onStartAudio();
    showInstructions(TEST_ORDER[0]);
  });

  beginTestButton.addEventListener("click", startActiveTest);
  continueButton.addEventListener("click", advanceToNextTest);
  restartButton.addEventListener("click", restartAssessment);

  modalCancel.addEventListener("click", closeModal);
  modalConfirm.addEventListener("click", confirmSwitch);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  for (const button of navButtons) {
    button.addEventListener("click", () => {
      requestTest(button.dataset.test);
    });
  }

  showScreen("title");

  return {
    startActiveTest,
    showTestResult,
    requestTest,
    isTestActive: () => currentScreen === "active",
    getCurrentTest: () => currentTest,
    getCompletedResults: () => ({ ...completedResults }),
    restartAssessment,
  };
}
