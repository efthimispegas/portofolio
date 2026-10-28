import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { BRAND } from "@mastoli/core";
import { useWallet, type Appearance } from "../src/lib/wallet-context";
import { useTheme } from "../src/lib/theme";
import { Button, Copy, Icon, Section, styles } from "../src/components/ui";
export default function Settings() {
  const w = useWallet();
  const c = useTheme();
  const { t } = w;
  const run = (fn: () => Promise<void>) =>
    void fn().catch(() => Alert.alert(t("error"), t("retry")));
  const choice = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        minHeight: 52,
        padding: 15,
        backgroundColor: c.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <Text style={{ color: c.text, fontSize: 17, flex: 1 }}>{label}</Text>
      {selected ? <Icon name="check" color={c.tint} /> : null}
    </Pressable>
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.heading, { color: c.text }]}>{BRAND}</Text>
      <Copy muted>
        {t("noAccount")} · {w.cards.length} {t("savedCount")}
      </Copy>
      <Section title={t("language")}>
        <View style={{ borderRadius: 14, overflow: "hidden" }}>
          {choice("Ελληνικά", w.language === "el", () =>
            run(() => w.setLanguage("el")),
          )}
          {choice("English", w.language === "en", () =>
            run(() => w.setLanguage("en")),
          )}
        </View>
      </Section>
      <Section title={t("appearance")}>
        <View style={{ borderRadius: 14, overflow: "hidden" }}>
          {(["system", "light", "dark"] as Appearance[]).map((mode) =>
            choice(t(mode), w.appearance === mode, () =>
              run(() => w.setAppearance(mode)),
            ),
          )}
        </View>
      </Section>
      <Section title={t("deviceOnly")}>
        <Copy>{t("deviceOnlyBody")}</Copy>
        <Copy muted>{t("backupNotice")}</Copy>
      </Section>
      <Section>
        <Button
          title={t("clear")}
          icon="trash"
          danger
          disabled={w.cards.length === 0}
          onPress={() =>
            Alert.alert(t("clearQuestion"), t("clearBody"), [
              { text: t("cancel"), style: "cancel" },
              {
                text: t("clearConfirm"),
                style: "destructive",
                onPress: () => run(w.clear),
              },
            ])
          }
        />
      </Section>
    </ScrollView>
  );
}
