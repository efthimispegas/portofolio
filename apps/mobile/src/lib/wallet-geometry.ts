// Source: docs/research/wallet-reference-measurements.md, sharp cyan boundaries.
// Normalize source pixels against the 1206px recording width, without assuming DPI.
export const walletCardAspectRatio = 1.59;
export function walletGeometry(viewportWidth: number) {
  const stackWidth = viewportWidth * (1084 / 1206);
  const detailWidth = viewportWidth * (1107 / 1206);
  return {
    stackInset: (viewportWidth - stackWidth) / 2,
    detailInset: (viewportWidth - detailWidth) / 2,
    stackHeight: stackWidth / walletCardAspectRatio,
    detailHeight: detailWidth / walletCardAspectRatio,
  };
}
