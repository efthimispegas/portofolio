const NAVY = "#07172D";

function luminance(hex: string) {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

/** Keep identity text readable even on a professional's very dark accent. */
export function cardColors(accent: string) {
  const background = /^#[\da-f]{6}$/i.test(accent) ? accent : "#DFE7F5";
  const light = luminance(background);
  const navy = (light + 0.05) / (luminance(NAVY) + 0.05);
  const white = 1.05 / (light + 0.05);
  const ink = navy >= 4.5 ? NAVY : white >= 4.5 ? "#FFFFFF" : "#000000";
  return { background, ink, darkInk: ink !== "#FFFFFF" };
}
