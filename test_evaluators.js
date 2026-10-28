import {
  getPoseMetrics,
  getFootLift,
  areFeetTogether,
  areArmsAtSides,
  getSwayRatio,
  isSideOn,
  getFingerToNoseRatios,
} from "./pose_math.js";

const PASS_THRESHOLD = 85;
const STEP_TARGET = 18;
const WALK_TIMEOUT_MS = 90000;
const TURN_WAIT_MS = 10000;
const ONE_LEG_TARGET_MS = 30000;
const ONE_LEG_TIMEOUT_MS = 45000;
const ROMBERG_TARGET_MS = 30000;
const ROMBERG_TIMEOUT_MS = 45000;
const FINGER_TARGET = 4;
const FINGER_TIMEOUT_MS = 30000;

export const TEST_INFO = {
  walkAndTurn: {
    label: "Walk-and-Turn",
    instructions:
      "Walk forward with clear alternating steps. After 9 steps, pivot briefly to face sideways, then take 9 more steps.",
    startMessage: "Start walking forward. I'll count your steps.",
  },
  oneLegStand: {
    label: "One-Leg Stand",
    instructions:
      "Raise one foot and hold it up for 30 seconds. Keep your arms close to your sides.",
    startMessage: "Raise one foot to start the timer.",
  },
  romberg: {
    label: "Romberg Balance",
    instructions:
      "Stand with your feet together and stay as still as you can for 30 seconds. Keep your eyes open for this webcam version.",
    startMessage: "Bring your feet together and hold still.",
  },
  fingerToNose: {
    label: "Finger to Nose",
    instructions:
      "Alternate touching your nose with your left and right index fingertips until you have made 4 touches.",
    startMessage:
      "Keep your face and both hands visible. Move a finger away, then touch your nose.",
  },
};

export function createTestState(testName) {
  return {
    testName,
    startedAt: null,
    done: false,
    lastLoggedBucket: -1,
    totalFrames: 0,
    footBaseline: {
      left: null,
      right: null,
    },
    footWasRaised: {
      left: false,
      right: false,
    },
    lastStepSide: null,
    stepCount: 0,
    phase: "outbound",
    turnCueFrames: 0,
    turnDetected: false,
    turnWaitStarted: null,
    holdStart: null,
    maxHoldMs: 0,
    raisedFrames: 0,
    armsAtSideFrames: 0,
    feetTogetherFrames: 0,
    stableFrames: 0,
    swayBaseline: null,
    handAway: {
      left: false,
      right: false,
    },
    expectedSide: null,
    lastTouchSide: null,
    fingerPhase: "touch",
    fingerTouches: 0,
  };
}

function updateFootEvents(landmarks, state, metrics, width, height) {
  const events = [];

  for (const side of ["left", "right"]) {
    const lift = getFootLift(landmarks, side, metrics, state, width, height);

    if (lift === null) {
      continue;
    }

    if (lift > 0.14 && !state.footWasRaised[side]) {
      state.footWasRaised[side] = true;
      events.push(side);
    }

    if (lift < 0.07) {
      state.footWasRaised[side] = false;
    }
  }

  return events;
}

function getLiftAmounts(landmarks, state, metrics, width, height) {
  return {
    left: getFootLift(landmarks, "left", metrics, state, width, height) ?? 0,
    right: getFootLift(landmarks, "right", metrics, state, width, height) ?? 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeResult(progress, scorePercent, done, detail, feedback) {
  const score = Math.round(clamp(scorePercent, 0, 100));

  return {
    progress: Math.round(clamp(progress, 0, 100)),
    scorePercent: score,
    failPercent: 100 - score,
    done,
    passed: score >= PASS_THRESHOLD,
    threshold: PASS_THRESHOLD,
    detail,
    feedback,
  };
}

function evaluateWalkAndTurn(
  landmarks,
  state,
  metrics,
  now,
  width,
  height,
  elapsed,
) {
  const events = updateFootEvents(landmarks, state, metrics, width, height);

  for (const side of events) {
    if (state.phase !== "outbound" && state.phase !== "return") {
      continue;
    }

    if (state.lastStepSide === side) {
      continue;
    }

    state.lastStepSide = side;
    state.stepCount = Math.min(STEP_TARGET, state.stepCount + 1);

    if (state.phase === "outbound" && state.stepCount >= 9) {
      state.phase = "waitingForTurn";
      state.turnWaitStarted = now;
    }
  }

  if (state.phase === "waitingForTurn") {
    if (isSideOn(landmarks, metrics, width, height)) {
      state.turnCueFrames += 1;
    } else {
      state.turnCueFrames = 0;
    }

    if (state.turnCueFrames >= 3) {
      state.turnDetected = true;
      state.phase = "return";
      state.turnWaitStarted = null;
    }
  }

  const stepRatio = Math.min(state.stepCount / STEP_TARGET, 1);
  const score = stepRatio * 75 + (state.turnDetected ? 25 : 0);
  const progress = stepRatio * 75 + (state.turnDetected ? 25 : 0);

  const turnTimedOut =
    state.phase === "waitingForTurn" &&
    state.turnWaitStarted !== null &&
    now - state.turnWaitStarted >= TURN_WAIT_MS;

  const complete = state.stepCount >= STEP_TARGET && state.turnDetected;
  const timedOut = elapsed >= WALK_TIMEOUT_MS || turnTimedOut;

  const detail = complete
    ? "All 18 alternating foot lifts and a turn were detected."
    : turnTimedOut
      ? "The turn was not detected after the ninth step."
      : "The walk-and-turn time limit was reached.";

  let feedback;

  if (complete) {
    feedback = "Walk-and-Turn complete!";
  } else if (timedOut) {
    feedback = turnTimedOut
      ? "Turn not detected. Select Walk-and-Turn to try again."
      : "Time limit reached. Select Walk-and-Turn to try again.";
  } else if (state.phase === "waitingForTurn") {
    feedback = "9 steps completed. Face to the side to continue.";
  } else if (state.phase === "return") {
    feedback = `Turn detected! Return steps: ${Math.max(0, state.stepCount - 9)} / 9`;
  } else {
    feedback = `Steps completed: ${Math.min(state.stepCount, 9)} / 9`;
  }

  return makeResult(progress, score, complete || timedOut, detail, feedback);
}

function evaluateOneLegStand(
  landmarks,
  state,
  metrics,
  now,
  width,
  height,
  elapsed,
) {
  const lifts = getLiftAmounts(landmarks, state, metrics, width, height);

  const leftRaised = lifts.left > 0.14;
  const rightRaised = lifts.right > 0.14;
  const oneFootRaised = leftRaised !== rightRaised;

  if (oneFootRaised) {
    if (state.holdStart === null) {
      state.holdStart = now;
    }

    const currentHold = now - state.holdStart;
    state.maxHoldMs = Math.max(state.maxHoldMs, currentHold);
    state.raisedFrames += 1;

    if (areArmsAtSides(landmarks, metrics, width, height)) {
      state.armsAtSideFrames += 1;
    }
  } else {
    state.holdStart = null;
  }

  const currentHold = state.holdStart === null ? 0 : now - state.holdStart;
  const holdRatio = clamp(state.maxHoldMs / ONE_LEG_TARGET_MS, 0, 1);
  const armRatio =
    state.raisedFrames > 0 ? state.armsAtSideFrames / state.raisedFrames : 0;

  const score = holdRatio * 70 + armRatio * 30;
  const progress = holdRatio * 100;
  const complete = currentHold >= ONE_LEG_TARGET_MS;
  const timedOut = elapsed >= ONE_LEG_TIMEOUT_MS;

  const detail = complete
    ? "The raised-foot hold reached 30 seconds."
    : "The one-leg stand time limit was reached.";

  let feedback;

  if (complete) {
    feedback = "Hold complete! You kept one foot raised for 30 seconds.";
  } else if (timedOut) {
    feedback = "Time limit reached. Select One-Leg Stand to try again.";
  } else if (!oneFootRaised) {
    feedback =
      state.maxHoldMs > 0
        ? "Your foot came down. Raise one foot and hold it up again."
        : "Raise one foot and keep it raised.";
  } else if (!areArmsAtSides(landmarks, metrics, width, height)) {
    feedback = `Keep your arms close to your sides. Hold: ${(currentHold / 1000).toFixed(1)} / 30 seconds`;
  } else {
    feedback = `Good! Keep holding: ${(currentHold / 1000).toFixed(1)} / 30 seconds`;
  }

  return makeResult(progress, score, complete || timedOut, detail, feedback);
}

function evaluateRomberg(
  landmarks,
  state,
  metrics,
  now,
  width,
  height,
  elapsed,
) {
  const feetTogether = areFeetTogether(landmarks, metrics, width, height);

  state.totalFrames += 1;

  if (feetTogether) {
    state.feetTogetherFrames += 1;
    const swayRatio = getSwayRatio(metrics, state);

    if (swayRatio <= 0.14) {
      state.stableFrames += 1;
    }

    if (state.holdStart === null) {
      state.holdStart = now;
    }

    state.maxHoldMs = Math.max(state.maxHoldMs, now - state.holdStart);
  } else {
    state.holdStart = null;
  }

  const currentHold = state.holdStart === null ? 0 : now - state.holdStart;
  const holdRatio = clamp(state.maxHoldMs / ROMBERG_TARGET_MS, 0, 1);
  const feetRatio =
    state.totalFrames > 0 ? state.feetTogetherFrames / state.totalFrames : 0;
  const stableRatio =
    state.totalFrames > 0 ? state.stableFrames / state.totalFrames : 0;

  const score = holdRatio * 60 + feetRatio * 20 + stableRatio * 20;
  const progress = holdRatio * 100;
  const complete = currentHold >= ROMBERG_TARGET_MS;
  const timedOut = elapsed >= ROMBERG_TIMEOUT_MS;

  const detail = complete
    ? "The feet-together balance hold reached 30 seconds."
    : "The balance time limit was reached.";

  const swayRatio = feetTogether ? getSwayRatio(metrics, state) : Infinity;
  let feedback;

  if (complete) {
    feedback = "Balance hold complete!";
  } else if (timedOut) {
    feedback = "Time limit reached. Select Romberg Balance to try again.";
  } else if (!feetTogether) {
    feedback = "Bring your feet together.";
  } else if (swayRatio > 0.14) {
    feedback = `Try to stay still. Hold: ${(currentHold / 1000).toFixed(1)} / 30 seconds`;
  } else {
    feedback = `Good balance! Keep holding: ${(currentHold / 1000).toFixed(1)} / 30 seconds`;
  }

  return makeResult(progress, score, complete || timedOut, detail, feedback);
}

function evaluateFingerToNose(
  landmarks,
  state,
  metrics,
  now,
  width,
  height,
  elapsed,
) {
  const ratios = getFingerToNoseRatios(landmarks, metrics, width, height);

  if (!ratios) {
    const progress = Math.min(state.fingerTouches / FINGER_TARGET, 1) * 100;
    const timedOut = elapsed >= FINGER_TIMEOUT_MS;

    return makeResult(
      progress,
      progress,
      timedOut,
      "Fingertip landmarks were not consistently visible.",
      timedOut
        ? "Time limit reached. Select Finger to Nose to try again."
        : "Move so your face and both index fingertips are visible.",
    );
  }

  const nearThreshold = 0.22;
  const awayThreshold = 0.4;

  for (const side of ["left", "right"]) {
    if (ratios[side] > awayThreshold) {
      state.handAway[side] = true;
    }
  }

  if (state.fingerPhase === "retreat") {
    if (state.lastTouchSide && ratios[state.lastTouchSide] > awayThreshold) {
      state.fingerPhase = "touch";
    }
  } else if (state.fingerTouches === 0) {
    const possibleTouches = ["left", "right"]
      .filter((side) => state.handAway[side] && ratios[side] < nearThreshold)
      .sort((a, b) => ratios[a] - ratios[b]);

    if (possibleTouches.length > 0) {
      const side = possibleTouches[0];

      state.fingerTouches += 1;
      state.lastTouchSide = side;
      state.expectedSide = side === "left" ? "right" : "left";
      state.handAway.left = false;
      state.handAway.right = false;
      state.fingerPhase = "retreat";
    }
  } else if (
    state.expectedSide &&
    state.handAway[state.expectedSide] &&
    ratios[state.expectedSide] < nearThreshold
  ) {
    const side = state.expectedSide;

    state.fingerTouches += 1;
    state.lastTouchSide = side;
    state.expectedSide = side === "left" ? "right" : "left";
    state.handAway.left = false;
    state.handAway.right = false;
    state.fingerPhase = "retreat";
  }

  const progress = Math.min(state.fingerTouches / FINGER_TARGET, 1) * 100;
  const score = progress;
  const complete = state.fingerTouches >= FINGER_TARGET;
  const timedOut = elapsed >= FINGER_TIMEOUT_MS;

  const detail = complete
    ? "Four alternating finger-to-nose touches were detected."
    : "The finger-to-nose time limit was reached.";

  let feedback;

  if (complete) {
    feedback = "4 / 4 touches completed!";
  } else if (timedOut) {
    feedback = "Time limit reached. Select Finger to Nose to try again.";
  } else if (state.fingerPhase === "retreat") {
    feedback = `Touch detected: ${state.fingerTouches} / ${FINGER_TARGET}. Move your hand away.`;
  } else if (state.expectedSide) {
    feedback = `Touches: ${state.fingerTouches} / ${FINGER_TARGET}. Touch your ${state.expectedSide} index finger to your nose.`;
  } else {
    feedback = `Touches: ${state.fingerTouches} / ${FINGER_TARGET}. Move one finger away, then touch your nose.`;
  }

  return makeResult(progress, score, complete || timedOut, detail, feedback);
}

export function evaluateTest(testName, landmarks, state, now, width, height) {
  if (state.done) {
    return null;
  }

  const metrics = getPoseMetrics(landmarks, width, height);

  if (!metrics) {
    return null;
  }

  if (state.startedAt === null) {
    state.startedAt = now;
  }

  const elapsed = now - state.startedAt;

  switch (testName) {
    case "walkAndTurn":
      return evaluateWalkAndTurn(
        landmarks,
        state,
        metrics,
        now,
        width,
        height,
        elapsed,
      );

    case "oneLegStand":
      return evaluateOneLegStand(
        landmarks,
        state,
        metrics,
        now,
        width,
        height,
        elapsed,
      );

    case "romberg":
      return evaluateRomberg(
        landmarks,
        state,
        metrics,
        now,
        width,
        height,
        elapsed,
      );

    case "fingerToNose":
      return evaluateFingerToNose(
        landmarks,
        state,
        metrics,
        now,
        width,
        height,
        elapsed,
      );

    default:
      return null;
  }
}
