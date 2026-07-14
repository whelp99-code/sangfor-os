export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return `${word}로`;
  // 로 after a vowel-final syllable (jongseong 0) or ㄹ (jongseong 8); 으로 otherwise.
  const jongseong = (code - 0xac00) % 28;
  return jongseong === 0 || jongseong === 8 ? `${word}로` : `${word}으로`;
}
