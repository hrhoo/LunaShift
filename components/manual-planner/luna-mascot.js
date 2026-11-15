/** Luna's supplied artwork, packed into aligned idle and bongo strips. */
export function lunaRabbit(kind='peek') {
 return `<span class="luna-rabbit luna-rabbit-${kind}" aria-hidden="true">
  <span class="luna-idle"><img src="/assets/luna/idle.png" alt="" draggable="false" width="600" height="380"></span>
  <span class="luna-bongo"><img src="/assets/luna/bongo.png" alt="" draggable="false" width="1200" height="380"></span>
 </span>`;
}

/** Count inserted letters/numbers, including edits in the middle of a draft. */
export function insertedLetters(previous, draft) {
  let start = 0, end = 0;
  while (start < previous.length && start < draft.length && previous[start] === draft[start]) start++;
  while (end < previous.length - start && end < draft.length - start && previous[previous.length - 1 - end] === draft[draft.length - 1 - end]) end++;
  return [...draft.slice(start, draft.length - end)].filter(c => /[\p{L}\p{N}]/u.test(c)).length;
}
