import { router } from "expo-router";
import { View } from "react-native";
import { Button, Copy, styles } from "../src/components/ui";
import { useWallet } from "../src/lib/wallet-context";
export default function NotFound() {
  const { t } = useWallet();
  return (
    <View style={styles.content}>
      <Copy>{t("unavailable")}</Copy>
      <Button title={t("wallet")} onPress={() => router.replace("/")} />
    </View>
  );
}
