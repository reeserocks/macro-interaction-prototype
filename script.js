
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

import { createTestState, evaluateTest, TEST_INFO } from "./test_evaluators.js";

const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);

const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "./models/pose_landmarker_full.task",
  },
  runningMode: "VIDEO",
  numPoses: 1,
});

const video = document.getElementById("video");
const canvasElement = document.getElementById("pose-canvas");
const canvasCtx = canvasElement.getContext("2d");
const instructionsElement = document.getElementById("instructions");
const feedbackElement = document.getElementById("test-feedback");
const testItems = document.querySelectorAll("[data-test]");

const drawingUtils = new DrawingUtils(canvasCtx);
const scores = {};

const officerImages = {
  good: document.getElementById("officer-good"),
  suspicious: document.getElementById("officer-suspicious"),
  failing: document.getElementById("officer-failing"),
};

const backgroundAudio = new Audio("sounds/Police walkie-talkie.mp3");
backgroundAudio.loop = true;
backgroundAudio.volume = 0.5;

const sirenAudio = new Audio("sounds/Police siren.mp3");
sirenAudio.volume = 0.12;

const passAudio = new Audio("sounds/Passed test sound.mp3");
passAudio.volume = 1;

const failAudio = new Audio("sounds/Short police siren.mp3");
failAudio.volume = 1;

let audioStarted = false;
let currentOfficerState = "good";

function playAudio(audio) {
  const playback = audio.play();

  if (playback) {
    playback.catch((error) => {
      console.warn("Audio playback failed:", error);
    });
  }
}

function startBackgroundAudio() {
  if (audioStarted) {
    return;
  }

  audioStarted = true;
  playAudio(backgroundAudio);

  console.log("Background audio started.");
  console.log(backgroundAudio);
}

function stopSiren() {
  sirenAudio.pause();
  sirenAudio.currentTime = 0;
}

function playFailureSound() {
  stopSiren();
  failAudio.currentTime = 0;
  playAudio(failAudio);
}

function playPassSound() {
  passAudio.currentTime = 0;
  playAudio(passAudio);
}

const speechSupported =
  "speechSynthesis" in window &&
  "SpeechSynthesisUtterance" in window;

let lastSpokenFeedback = "";

function speakFeedback(text) {
  if (!speechSupported || !text.trim()) {
    return;
  }

  const speechText = text
    .replace(/\n+/g, ". ")
    .replace(
      /(?:Hold|Keep holding): \d+(?:\.\d+)? \/ 30 seconds/g,
      "Keep holding for 30 seconds",
    );

  if (speechText === lastSpokenFeedback) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(speechText);

  utterance.lang = "en-US";
  utterance.rate = 0.95;
  utterance.pitch = 0.85;
  utterance.volume = 1;

  window.speechSynthesis.speak(utterance);

  lastSpokenFeedback = speechText;
}

function setFeedback(text) {
  feedbackElement.textContent = text;
  speakFeedback(text);
}

function setOfficerState(state) {
  for (const [name, image] of Object.entries(officerImages)) {
    image.classList.toggle("active", name === state);
  }

  currentOfficerState = state;

  if (state === "suspicious") {
    sirenAudio.loop = true;
    sirenAudio.volume = 0.12;

    if (sirenAudio.paused) {
      playAudio(sirenAudio);
    }
  } else {
    stopSiren();
  }
}

function updateOfficerState(result) {
  if (!result) {
    return;
  }

  if (result.done) {
    setOfficerState(result.passed ? "good" : "failing");
  } else if (result.progress >= 60) {
    setOfficerState("good");
  } else if (result.progress > 0) {
    setOfficerState("suspicious");
  } else {
    setOfficerState("good");
  }
}

let lastVideoTime = -1;
let missingPoseFrames = 0;
let currentTest = "walkAndTurn";
let testState = createTestState(currentTest);

function setCurrentTest(testName) {
  if (!TEST_INFO[testName]) {
    console.error(
      "Unknown test name. Use walkAndTurn, oneLegStand, romberg, or fingerToNose.",
    );
    return;
  }

  currentTest = testName;
  testState = createTestState(currentTest);
  lastSpokenFeedback = "";

  stopSiren();
  instructionsElement.textContent = TEST_INFO[currentTest].instructions;
  setFeedback(TEST_INFO[currentTest].startMessage);
  setOfficerState("good");
}

function recordResult(result) {
  if (!result || !result.done || testState.done) {
    return;
  }

  testState.done = true;

  const record = {
    scorePercent: result.scorePercent,
    failPercent: result.failPercent,
    result: result.passed ? "PASS" : "FAIL",
    detail: result.detail,
  };

  scores[currentTest] = record;

  if (result.passed) {
    playPassSound();
  } else {
    playFailureSound();
  }

  const nextStep =
    record.result === "PASS"
      ? "Select another test or select this one to retry."
      : "Select this test to try again, or choose another test.";

  setFeedback(
    [
      `${TEST_INFO[currentTest].label} — ${record.result}`,
      `Movement completion score: ${record.scorePercent}%`,
      `Score shortfall: ${record.failPercent}%`,
      record.detail,
      "",
      nextStep,
    ].join("\n"),
  );

  console.table(scores);
}

function handleEvaluation(result) {
  if (!result) {
    return;
  }

  updateOfficerState(result);

  if (result.feedback && !result.done) {
    setFeedback(result.feedback);
  }

  const bucket = Math.floor(result.progress / 10);

  if (bucket > testState.lastLoggedBucket) {
    testState.lastLoggedBucket = bucket;

    console.log(
      `[${TEST_INFO[currentTest].label}] Sequence progress: ${Math.min(bucket * 10, 100)}%`,
    );
  }

  recordResult(result);
}

function resizeCanvasToVideo() {
  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  canvasElement.width = video.videoWidth;
  canvasElement.height = video.videoHeight;
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access is not available in this browser or context.",
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 640,
        height: 480,
        facingMode: "user",
      },
      audio: false,
    });

    video.addEventListener(
      "loadeddata",
      () => {
        resizeCanvasToVideo();
        setCurrentTest(currentTest);
        renderLoop();
      },
      { once: true },
    );

    video.srcObject = stream;
    await video.play();
  } catch (error) {
    console.error("Unable to start camera:", error);
  }
}

function renderLoop() {
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    const now = performance.now();
    const results = poseLandmarker.detectForVideo(video, now);

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.landmarks && results.landmarks.length > 0) {
      missingPoseFrames = 0;

      const landmarks = results.landmarks[0];

      drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: "#00FF00",
        lineWidth: 4,
      });

      drawingUtils.drawLandmarks(landmarks, {
        color: "#FF0000",
        lineWidth: 2,
        radius: 4,
      });

      const result = evaluateTest(
        currentTest,
        landmarks,
        testState,
        now,
        canvasElement.width,
        canvasElement.height,
      );

      handleEvaluation(result);
    } else {
      missingPoseFrames += 1;

      if (missingPoseFrames === 15 && !testState.done) {
        setFeedback("Move into view so I can see your pose.");
        setOfficerState("suspicious");
      }
    }

    lastVideoTime = video.currentTime;
  }

  requestAnimationFrame(renderLoop);
}

function chooseTestFromItem(item) {
  const testName = item.dataset.test;
  setCurrentTest(testName);
}

for (const item of testItems) {
  item.addEventListener("click", () => chooseTestFromItem(item));

  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseTestFromItem(item);
    }
  });
}

window.setCurrentTest = setCurrentTest;
window.getTestScores = () => ({ ...scores });

startCamera();
startBackgroundAudio();
