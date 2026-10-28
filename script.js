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

  instructionsElement.textContent = TEST_INFO[currentTest].instructions;
  feedbackElement.textContent = TEST_INFO[currentTest].startMessage;

  console.log(
    `[${TEST_INFO[currentTest].label}] Ready.`,
    TEST_INFO[currentTest].instructions,
  );
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

  console.log(`[${TEST_INFO[currentTest].label}] ${record.result}`);
  console.log(`Movement completion score: ${record.scorePercent}%`);
  console.log(`Score shortfall: ${record.failPercent}%`);
  console.log(record.detail);

  const nextStep =
    record.result === "PASS"
      ? "Select another test or select this one to retry."
      : "Select this test to try again, or choose another test.";

  feedbackElement.textContent = [
    `${TEST_INFO[currentTest].label} — ${record.result}`,
    `Movement completion score: ${record.scorePercent}%`,
    `Score shortfall: ${record.failPercent}%`,
    record.detail,
    "",
    nextStep,
  ].join("\n");

  console.table(scores);
}

function handleEvaluation(result) {
  if (!result) {
    return;
  }

  if (result.feedback) {
    feedbackElement.textContent = result.feedback;
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
        feedbackElement.textContent = "Move into view so I can see your pose.";
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
