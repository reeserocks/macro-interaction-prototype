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
const STEP_TARGET = 8;
const STEPS_BEFORE_TURN = 4;
const ONE_LEG_TARGET_MS = 30000;
const ROMBERG_TARGET_MS = 30000;
const FINGER_TARGET = 4;

export const TEST_INFO = {
  walkAndTurn: {
    label: "Walk-and-Turn",
    instructions:
      "Turn to the side and walk forward with clear alternating steps. After 4 steps, pivot to face the other direction, then take 4 more steps.",
    startMessage: "Turn to the side so your body is in profile.",
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
      "Stand with your feet together, close your eyes, and stay as still as you can. Open your eyes and resume a natural resting stance when you think 30 seconds have passed.",
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
    done: false,
    lastLoggedBucket: -1,
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
    phase: "positioning",
    turnCueFrames: 0,
    turnSawFront: false,
    turnDetected: false,
    holdStart: null,
    maxHoldMs: 0,
    raisedFrames: 0,
    armsAtSideFrames: 0,
    feetTogetherFrames: 0,
    stableFrames: 0,
    totalFrames: 0,
    swayBaseline: null,
    holdInterrupted: false,
    oneLegInterrupted: false,
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

function evaluateWalkAndTurn(landmarks, state, metrics, now, width, height) {
  const sideOn = isSideOn(landmarks, metrics, width, height);

  const events = updateFootEvents(landmarks, state, metrics, width, height);

  if (state.phase === "positioning") {
    if (sideOn) {
      state.turnCueFrames += 1;
    } else {
      state.turnCueFrames = 0;
    }

    if (state.turnCueFrames >= 3) {
      state.phase = "outbound";
      state.turnCueFrames = 0;

      return makeResult(
        0,
        0,
        false,
        "Side-facing starting position detected.",
        "Good! Take your first 4 steps forward.",
      );
    }

    return makeResult(
      0,
      0,
      false,
      "Waiting for a side-facing position.",
      "Turn to the side so your body is in profile.",
    );
  }

  for (const side of events) {
    if (state.phase !== "outbound" && state.phase !== "return") {
      continue;
    }

    if (state.lastStepSide === side) {
      continue;
    }

    state.lastStepSide = side;
    state.stepCount = Math.min(STEP_TARGET, state.stepCount + 1);

    if (state.phase === "outbound" && state.stepCount >= STEPS_BEFORE_TURN) {
      state.phase = "waitingForTurn";
      state.turnCueFrames = 0;
      state.turnSawFront = false;
    }
  }

  if (state.phase === "waitingForTurn") {
    if (!sideOn) {
      state.turnSawFront = true;
      state.turnCueFrames = 0;
    } else if (state.turnSawFront) {
      state.turnCueFrames += 1;

      if (state.turnCueFrames >= 3) {
        state.turnDetected = true;
        state.phase = "return";
        state.turnCueFrames = 0;
      }
    }
  }

  const stepRatio = Math.min(state.stepCount / STEP_TARGET, 1);

  const score = stepRatio * 75 + (state.turnDetected ? 25 : 0);

  const progress = score;
  const complete = state.stepCount >= STEP_TARGET && state.turnDetected;

  const detail = complete
    ? "All 8 alternating foot lifts and a turn were detected."
    : "Walk-and-Turn sequence is in progress.";

  let feedback;

  if (complete) {
    feedback = "Walk-and-Turn complete!";
  } else if (state.phase === "waitingForTurn") {
    feedback =
      "4 steps completed. Pivot to face the other direction, then face sideways again.";
  } else if (state.phase === "return") {
    feedback = `Turn detected! Return steps: ${Math.max(
      0,
      state.stepCount - STEPS_BEFORE_TURN,
    )} / 4`;
  } else {
    feedback = `Steps completed: ${Math.min(
      state.stepCount,
      STEPS_BEFORE_TURN,
    )} / 4`;
  }

  return makeResult(progress, score, complete, detail, feedback);
}

function evaluateOneLegStand(landmarks, state, metrics, now, width, height) {
  const lifts = getLiftAmounts(landmarks, state, metrics, width, height);

  const leftRaised = lifts.left > 0.14;
  const rightRaised = lifts.right > 0.14;
  const oneFootRaised = leftRaised !== rightRaised;

  if (oneFootRaised) {
    if (state.holdStart === null) {
      state.holdStart = now;
      state.raisedFrames = 0;
      state.armsAtSideFrames = 0;
      state.oneLegInterrupted = false;
    }

    state.raisedFrames += 1;

    if (areArmsAtSides(landmarks, metrics, width, height)) {
      state.armsAtSideFrames += 1;
    }
  } else if (state.holdStart !== null) {
    state.holdStart = null;
    state.raisedFrames = 0;
    state.armsAtSideFrames = 0;
    state.oneLegInterrupted = true;
  }

  const currentHold = state.holdStart === null ? 0 : now - state.holdStart;

  const holdRatio = clamp(currentHold / ONE_LEG_TARGET_MS, 0, 1);

  const armRatio =
    state.raisedFrames > 0 ? state.armsAtSideFrames / state.raisedFrames : 0;

  const score = holdRatio * 70 + armRatio * 30;
  const progress = holdRatio * 100;
  const complete = currentHold >= ONE_LEG_TARGET_MS;

  const detail = complete
    ? "The raised-foot hold reached 30 continuous seconds."
    : "Keep one foot raised for a continuous 30-second hold.";

  let feedback;

  if (complete) {
    feedback = "Hold complete! You kept one foot raised for 30 seconds.";
  } else if (!oneFootRaised) {
    feedback = state.oneLegInterrupted
      ? "Your foot came down. Raise one foot and hold it up again."
      : "Raise one foot and keep it raised.";
  } else if (!areArmsAtSides(landmarks, metrics, width, height)) {
    feedback = `Keep your arms close to your sides. Hold: ${(
      currentHold / 1000
    ).toFixed(1)} / 30 seconds`;
  } else {
    feedback = `Good! Keep holding: ${(currentHold / 1000).toFixed(
      1,
    )} / 30 seconds`;
  }

  return makeResult(progress, score, complete, detail, feedback);
}

function evaluateRomberg(landmarks, state, metrics, now, width, height) {
  const feetTogether = areFeetTogether(landmarks, metrics, width, height);

  if (feetTogether) {
    if (state.holdStart === null) {
      state.holdStart = now;
      state.maxHoldMs = 0;
      state.totalFrames = 0;
      state.feetTogetherFrames = 0;
      state.stableFrames = 0;
      state.swayBaseline = null;
      state.holdInterrupted = false;
    }

    const currentHold = now - state.holdStart;

    state.maxHoldMs = Math.max(state.maxHoldMs, currentHold);

    state.totalFrames += 1;
    state.feetTogetherFrames += 1;

    const swayRatio = getSwayRatio(metrics, state);

    if (swayRatio <= 0.14) {
      state.stableFrames += 1;
    }
  } else if (state.holdStart !== null) {
    const lastHold = now - state.holdStart;

    state.maxHoldMs = Math.max(state.maxHoldMs, lastHold);

    state.holdStart = null;
    state.swayBaseline = null;

    if (state.maxHoldMs < ROMBERG_TARGET_MS) {
      state.holdInterrupted = true;
      state.maxHoldMs = 0;
      state.totalFrames = 0;
      state.feetTogetherFrames = 0;
      state.stableFrames = 0;
    }
  }

  const currentHold = state.holdStart === null ? 0 : now - state.holdStart;

  const holdRatio = clamp(state.maxHoldMs / ROMBERG_TARGET_MS, 0, 1);

  const feetRatio =
    state.totalFrames > 0 ? state.feetTogetherFrames / state.totalFrames : 0;

  const stableRatio =
    state.totalFrames > 0 ? state.stableFrames / state.totalFrames : 0;

  const score = holdRatio * 60 + feetRatio * 20 + stableRatio * 20;

  const progress = holdRatio * 100;

  const complete =
    !feetTogether &&
    state.holdStart === null &&
    state.maxHoldMs >= ROMBERG_TARGET_MS;

  const detail = complete
    ? "A 30-second feet-together hold was detected, followed by a return to a resting stance."
    : "Hold your feet together for at least 30 seconds, then return to a resting stance.";

  let feedback;

  if (complete) {
    feedback =
      "Balance complete! Your return to a resting stance was detected.";
  } else if (!feetTogether) {
    feedback = state.holdInterrupted
      ? "You returned to a resting stance before 30 seconds. Bring your feet together and try again."
      : "Bring your feet together to begin the 30-second hold.";
  } else if (currentHold >= ROMBERG_TARGET_MS) {
    feedback =
      "When you think 30 seconds have passed, open your eyes and return to a natural resting stance.";
  } else {
    feedback = `Close your eyes and stay as still as you can. Hold: ${(
      currentHold / 1000
    ).toFixed(1)} / 30 seconds`;
  }

  return makeResult(progress, score, complete, detail, feedback);
}

function evaluateFingerToNose(landmarks, state, metrics, now, width, height) {
  const ratios = getFingerToNoseRatios(landmarks, metrics, width, height);

  const progress = Math.min(state.fingerTouches / FINGER_TARGET, 1) * 100;

  if (!ratios) {
    return makeResult(
      progress,
      progress,
      false,
      "Fingertip landmarks are not consistently visible.",
      "Move so your face and both index fingertips are visible.",
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

  const updatedProgress =
    Math.min(state.fingerTouches / FINGER_TARGET, 1) * 100;

  const score = updatedProgress;
  const complete = state.fingerTouches >= FINGER_TARGET;

  const detail = complete
    ? "Four alternating finger-to-nose touches were detected."
    : "The finger-to-nose sequence is still in progress.";

  let feedback;

  if (complete) {
    feedback = "4 / 4 touches completed!";
  } else if (state.fingerPhase === "retreat") {
    feedback = `Touch detected: ${state.fingerTouches} / ${FINGER_TARGET}. Move your hand away.`;
  } else if (state.expectedSide) {
    feedback = `Touches: ${state.fingerTouches} / ${FINGER_TARGET}. Touch your ${state.expectedSide} index finger to your nose.`;
  } else {
    feedback = `Touches: ${state.fingerTouches} / ${FINGER_TARGET}. Move one finger away, then touch your nose.`;
  }

  return makeResult(updatedProgress, score, complete, detail, feedback);
}

export function evaluateTest(testName, landmarks, state, now, width, height) {
  if (state.done) {
    return null;
  }

  const metrics = getPoseMetrics(landmarks, width, height);

  if (!metrics) {
    return null;
  }

  switch (testName) {
    case "walkAndTurn":
      return evaluateWalkAndTurn(landmarks, state, metrics, now, width, height);

    case "oneLegStand":
      return evaluateOneLegStand(landmarks, state, metrics, now, width, height);

    case "romberg":
      return evaluateRomberg(landmarks, state, metrics, now, width, height);

    case "fingerToNose":
      return evaluateFingerToNose(
        landmarks,
        state,
        metrics,
        now,
        width,
        height,
      );

    default:
      return null;
  }
}
