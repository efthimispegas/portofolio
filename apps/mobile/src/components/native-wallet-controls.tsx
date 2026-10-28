import { useState } from "react";
import { Alert, Share } from "react-native";
import { Stack, router } from "expo-router";
import { useWallet } from "../lib/wallet-context";
import { useTheme } from "../lib/theme";
import { useWalletMotion } from "../lib/wallet-motion";
import { cardUrl } from "../lib/config";
import { fetchCard } from "../lib/api";
export function NativeWalletControls({ detail }: { detail: boolean }) {
  const w = useWallet(),
    c = useTheme(),
    motion = useWalletMotion();
  const [refreshing, setRefreshing] = useState(false);
  const current = w.cards.find((x) => x.card.id === motion.session?.card.id);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      Alert.alert(w.t("error"), w.t("retry"));
    }
  };
  const share = () => {
    if (!current) return;
    const send = () =>
      void run(() =>
        Share.share({
          url: cardUrl(current.card.slug),
          message: current.card.displayName,
        }),
      );
    if (current.card.isDemo)
      Alert.alert(w.t("sample"), w.t("demoShare"), [
        { text: w.t("cancel"), style: "cancel" },
        { text: w.t("share"), onPress: send },
      ]);
    else send();
  };
  const refresh = async () => {
    if (!current || refreshing) return;
    if (current.card.isDemo) {
      Alert.alert(w.t("sample"), w.t("sampleBody"));
      return;
    }
    setRefreshing(true);
    try {
      const fresh = await fetchCard(current.card.slug);
      if (fresh.id !== current.card.id) throw Error("Card identity mismatch");
      await w.refresh(fresh);
    } catch {
      Alert.alert(w.t("offline"));
    } finally {
      setRefreshing(false);
    }
  };
  const remove = () => {
    if (!current) return;
    const id = current.card.id;
    Alert.alert(w.t("removeQuestion"), w.t("removeBody"), [
      { text: w.t("cancel"), style: "cancel" },
      {
        text: w.t("remove"),
        style: "destructive",
        onPress: () => void run(() => w.remove(id)),
      },
    ]);
  };
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          tintColor={c.tint}
          icon="xmark"
          hidden={!detail}
          accessibilityLabel={w.t("close")}
          onPress={() => motion.close()}
          separateBackground
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          tintColor={c.tint}
          icon={detail ? "square.and.arrow.up" : "plus"}
          accessibilityLabel={w.t(detail ? "share" : "add")}
          onPress={detail ? share : () => router.push("/add")}
          separateBackground
        />
        <Stack.Toolbar.Menu
          tintColor={c.tint}
          icon="ellipsis"
          accessibilityLabel={w.language === "el" ? "Περισσότερα" : "More"}
          separateBackground
        >
          {!detail ? (
            <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push("/settings")}>
              {w.t("settings")}
            </Stack.Toolbar.MenuAction>
          ) : null}
          {detail ? <Stack.Toolbar.MenuAction
            icon={current?.favorite ? "star.fill" : "star"}
            isOn={current?.favorite ?? false}
            onPress={() => {
              if (current)
                void run(() => w.favorite(current.card.id, !current.favorite));
            }}
          >
            {w.t(current?.favorite ? "unfavorite" : "favorite")}
          </Stack.Toolbar.MenuAction> : null}
          {detail ? <Stack.Toolbar.MenuAction
            icon="qrcode"
            onPress={() => {
              if (current)
                router.push({
                  pathname: "/share/[slug]",
                  params: { slug: current.card.slug },
                });
            }}
          >
            {w.t("showQr")}
          </Stack.Toolbar.MenuAction> : null}
          {detail ? <Stack.Toolbar.MenuAction
            icon="arrow.clockwise"
            disabled={refreshing}
            onPress={() => void refresh()}
          >
            {w.t("refresh")}
          </Stack.Toolbar.MenuAction> : null}
          {detail ? <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction icon="trash" destructive onPress={remove}>
              {w.t("remove")}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu> : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );
}
