/**
 * The recorder window owns the microphone from Phase 2 on: a permanently warm
 * getUserMedia stream feeding the pcm-collector worklet. This entry exists so
 * the window has a renderer target from day one; Phase 2 fills it in.
 */
export {};
