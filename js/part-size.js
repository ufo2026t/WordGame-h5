export function createPartSlots(partSize) {
  const size = Math.max(0, Number(partSize) || 0);
  if (size <= 0) return null;
  return {
    pointer: 0,
    slots: new Array(size + 1).fill(0),
  };
}

export function getPartSlots(saveRef, libName, partSize) {
  if (!partSize || partSize <= 0) return null;
  if (!saveRef.partSlotsByLib) saveRef.partSlotsByLib = {};
  if (!saveRef.partSlotsByLib[libName]) {
    saveRef.partSlotsByLib[libName] = createPartSlots(partSize);
  }
  const slots = saveRef.partSlotsByLib[libName];
  if (slots.slots.length !== partSize + 1) {
    saveRef.partSlotsByLib[libName] = createPartSlots(partSize);
  }
  return saveRef.partSlotsByLib[libName];
}

/** Returns word index from segment queue, or -1. */
export function pickPartWordIndex(partState) {
  if (!partState || partState.pointer <= 0) return -1;
  if (partState.pointer > partState.slots.length - 1) partState.pointer = 1;
  const id = partState.slots[partState.pointer];
  partState.pointer += 1;
  return id > 0 ? id : -1;
}

export function rememberPartWord(partState, wordIndex) {
  if (!partState || partState.pointer !== 0) return;
  for (let i = 1; i < partState.slots.length; i += 1) {
    if (i === partState.slots.length - 1) partState.pointer = 1;
    if (partState.slots[i] === 0) {
      partState.slots[i] = wordIndex;
      return;
    }
  }
}

export function clearPartWord(partState, wordIndex) {
  if (!partState) return;
  for (let i = 1; i < partState.slots.length; i += 1) {
    if (partState.slots[i] === wordIndex) {
      partState.slots[i] = 0;
      partState.pointer = 0;
    }
  }
}
