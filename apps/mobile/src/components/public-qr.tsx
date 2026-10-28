import { useMemo } from "react";
import { PixelRatio, View } from "react-native";
import QRCode from "qrcode/lib/core/qrcode";

/** Actual QR modules rendered as crisp native rectangles, with a four-module quiet zone. */
export function PublicQr({
  url,
  availableSize,
}: {
  url: string;
  availableSize: number;
}) {
  const qr = useMemo(() => {
    const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
    const runs: { row: number; column: number; length: number }[] = [];
    for (let row = 0; row < modules.size; row++) {
      for (let column = 0; column < modules.size; column++) {
        if (!modules.get(row, column)) continue;
        const start = column;
        while (column + 1 < modules.size && modules.get(row, column + 1))
          column++;
        runs.push({ row, column: start, length: column - start + 1 });
      }
    }
    return { count: modules.size, runs };
  }, [url]);
  const pixelRatio = PixelRatio.get();
  const cell =
    Math.max(1, Math.floor((availableSize * pixelRatio) / (qr.count + 8))) /
    pixelRatio;
  const size = (qr.count + 8) * cell;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, backgroundColor: "#FFFFFF" }}
    >
      {qr.runs.map((run) => (
        <View
          key={`${run.row}-${run.column}`}
          style={{
            position: "absolute",
            top: (run.row + 4) * cell,
            left: (run.column + 4) * cell,
            height: cell,
            width: run.length * cell,
            backgroundColor: "#000000",
          }}
        />
      ))}
    </View>
  );
}
