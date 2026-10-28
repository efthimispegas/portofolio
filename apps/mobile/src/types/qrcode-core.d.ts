declare module "qrcode/lib/core/qrcode" {
  const encoder: {
    create(
      text: string,
      options: { errorCorrectionLevel: "M" },
    ): {
      modules: { size: number; get(row: number, column: number): number };
    };
  };
  export default encoder;
}
