//pose_math.js

const LANDMARKS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
};

const MIN_VISIBILITY = 0.35;

export function getPoint(landmarks, index, width, height) {
  const point = landmarks[index];

  if (!point || (point.visibility ?? 1) < MIN_VISIBILITY) {
    return null;
  }

  return {
    x: point.x * width,
    y: point.y * height,
    z: point.z ?? 0,
  };
}

export function midpoint(a, b) {
  if (!a || !b) {
    return null;
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

export function distance(a, b) {
  if (!a || !b) {
    return Infinity;
  }

  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getPoseMetrics(landmarks, width, height) {
  const leftShoulder = getPoint(
    landmarks,
    LANDMARKS.leftShoulder,
    width,
    height,
  );
  const rightShoulder = getPoint(
    landmarks,
    LANDMARKS.rightShoulder,
    width,
    height,
  );
  const leftHip = getPoint(landmarks, LANDMARKS.leftHip, width, height);
  const rightHip = getPoint(landmarks, LANDMARKS.rightHip, width, height);

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const torsoHeight = distance(shoulderCenter, hipCenter);

  if (!Number.isFinite(torsoHeight) || torsoHeight < 1) {
    return null;
  }

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    shoulderCenter,
    hipCenter,
    torsoHeight,
  };
}

export function getFootLift(landmarks, side, metrics, state, width, height) {
  const index = side === "left" ? LANDMARKS.leftAnkle : LANDMARKS.rightAnkle;
  const ankle = getPoint(landmarks, index, width, height);

  if (!ankle) {
    return null;
  }

  const currentRelativeHeight =
    (ankle.y - metrics.hipCenter.y) / metrics.torsoHeight;

  if (state.footBaseline[side] === null) {
    state.footBaseline[side] = currentRelativeHeight;
    return 0;
  }

  const lift = state.footBaseline[side] - currentRelativeHeight;

  if (lift < 0.06) {
    state.footBaseline[side] =
      state.footBaseline[side] * 0.85 + currentRelativeHeight * 0.15;
  }

  return lift;
}

export function areFeetTogether(landmarks, metrics, width, height) {
  const leftAnkle = getPoint(landmarks, LANDMARKS.leftAnkle, width, height);
  const rightAnkle = getPoint(landmarks, LANDMARKS.rightAnkle, width, height);

  if (!leftAnkle || !rightAnkle) {
    return false;
  }

  const horizontalGap =
    Math.abs(leftAnkle.x - rightAnkle.x) / metrics.torsoHeight;

  const verticalGap =
    Math.abs(leftAnkle.y - rightAnkle.y) / metrics.torsoHeight;

  return horizontalGap < 0.38 && verticalGap < 0.16;
}

export function areArmsAtSides(landmarks, metrics, width, height) {
  const leftWrist = getPoint(landmarks, LANDMARKS.leftWrist, width, height);
  const rightWrist = getPoint(landmarks, LANDMARKS.rightWrist, width, height);

  if (!leftWrist || !rightWrist) {
    return false;
  }

  const leftOffset =
    Math.abs(leftWrist.x - metrics.leftHip.x) / metrics.torsoHeight;

  const rightOffset =
    Math.abs(rightWrist.x - metrics.rightHip.x) / metrics.torsoHeight;

  return leftOffset < 0.45 && rightOffset < 0.45;
}

export function getSwayRatio(metrics, state) {
  if (!state.swayBaseline) {
    state.swayBaseline = {
      x: metrics.hipCenter.x,
      y: metrics.hipCenter.y,
    };

    return 0;
  }

  const horizontalMovement = Math.abs(
    metrics.hipCenter.x - state.swayBaseline.x,
  );

  const verticalMovement = Math.abs(metrics.hipCenter.y - state.swayBaseline.y);

  return Math.max(horizontalMovement, verticalMovement) / metrics.torsoHeight;
}

export function isSideOn(landmarks, metrics, width, height) {
  const leftShoulder = getPoint(
    landmarks,
    LANDMARKS.leftShoulder,
    width,
    height,
  );
  const rightShoulder = getPoint(
    landmarks,
    LANDMARKS.rightShoulder,
    width,
    height,
  );

  if (!leftShoulder || !rightShoulder) {
    return false;
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const widthRatio = shoulderWidth / metrics.torsoHeight;
  const depthSpan = Math.abs(leftShoulder.z - rightShoulder.z) * width;
  const depthRatio = depthSpan / Math.max(shoulderWidth, 1);

  return widthRatio < 0.3 || depthRatio > 0.8;
}

export function getFingerToNoseRatios(landmarks, metrics, width, height) {
  const nose = getPoint(landmarks, LANDMARKS.nose, width, height);
  const leftIndex = getPoint(landmarks, LANDMARKS.leftIndex, width, height);
  const rightIndex = getPoint(landmarks, LANDMARKS.rightIndex, width, height);

  if (!nose || !leftIndex || !rightIndex) {
    return null;
  }

  return {
    left: distance(nose, leftIndex) / metrics.torsoHeight,
    right: distance(nose, rightIndex) / metrics.torsoHeight,
  };
}
