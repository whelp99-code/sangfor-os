# Hometax CryptoJS rollups (vendored)

국세청 홈택스 보안메일 복호화용 공식 CryptoJS rollup.
출처: https://srtk.hometax.go.kr/download/rollups/{seed,aes}.js
- seed.js: CryptoJS core + MD5 + enc.Base64 + SEED (CBC) 포함
- aes.js : CryptoJS core + AES

표준 npm `crypto-js`에는 SEED/ARIA가 없으므로 벤더링한다.
`crypto.ts`가 vm 컨텍스트에서 로드해 `CryptoJS`를 추출한다.
