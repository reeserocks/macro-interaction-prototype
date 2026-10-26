import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
);

const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "./models/pose_landmarker_full.task",
  },
  runningMode: "VIDEO",
});

const video = document.getElementById("video");
const canvasElement = document.getElementById("pose-canvas");
const canvasCtx = canvasElement.getContext("2d");

const drawingUtils = new DrawingUtils(canvasCtx);

let lastVideoTime = -1;

async function startCamera() {
  try {
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
        canvasElement.width = video.videoWidth;
        canvasElement.height = video.videoHeight;

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
    const results = poseLandmarker.detectForVideo(video, performance.now());

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    for (const landmarks of results.landmarks) {
      drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: "#00FF00",
        lineWidth: 4,
      });

      drawingUtils.drawLandmarks(landmarks, {
        color: "#FF0000",
        lineWidth: 2,
        radius: 4,
      });
    }

    lastVideoTime = video.currentTime;
  }

  requestAnimationFrame(renderLoop);
}

startCamera();
