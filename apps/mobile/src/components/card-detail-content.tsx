import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  Linking,
  Keyboard,
  ScrollView,
  type ScrollViewInstance,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { demoCards, routeLabels, type ProviderCard } from "@mastoli/core";
import { useWallet } from "../lib/wallet-context";
import { useTheme } from "../lib/theme";
import { fetchCard } from "../lib/api";
import { cardUrl, safeContactUrl } from "../lib/config";
import { ProviderTile } from "./provider-card";
import { Button, Copy, IconButton, Section, styles } from "./ui";
export function CardDetailContent({
  slug,
  sample,
  embedded = false,
  hero,
  detailsOpacity = 1,
  scrollEnabled = true,
  onShowQr,
  onRemoved,
}: {
  slug: string;
  sample?: string;
  embedded?: boolean;
  hero?: ReactNode;
  detailsOpacity?:
    number | Animated.Value | Animated.AnimatedInterpolation<number>;
  scrollEnabled?: boolean;
  onShowQr?: () => void;
  onRemoved?: () => void;
}) {
  const w = useWallet();
  const c = useTheme();
  const { t } = w;
  const saved = w.cards.find((item) => item.card.slug === slug);
  const demo =
    sample === "1" ? demoCards.find((item) => item.slug === slug) : undefined;
  const [remote, setRemote] = useState<ProviderCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(saved?.note ?? "");
  const scroll = useRef<ScrollViewInstance>(null);
  const noteSectionY = useRef(0);
  const bodyY = useRef(0);
  const noteFocused = useRef(false);
  const revealNote = useCallback(() => {
    if (noteFocused.current)
      scroll.current?.scrollTo({
        y: Math.max(0, bodyY.current + noteSectionY.current - 12),
        animated: true,
      });
  }, []);
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", revealNote);
    return () => subscription.remove();
  }, [revealNote]);
  const walletRef = useRef(w);
  walletRef.current = w;
  const card = remote ?? saved?.card ?? demo;
  const isDemo = Boolean(card?.isDemo);
  const request = useRef(0);
  useEffect(() => {
    setNote(saved?.note ?? "");
  }, [saved?.card.id]);
  const load = useCallback(async () => {
    const local = walletRef.current.cards.find(
      (item) => item.card.slug === slug,
    );
    if (
      local?.card.isDemo ||
      (sample === "1" && demoCards.some((item) => item.slug === slug))
    )
      return;
    const token = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const latest = await fetchCard(slug);
      if (local && latest.id !== local.card.id)
        throw new Error("Card identity changed");
      if (request.current !== token) return;
      setRemote(latest);
      if (local) await walletRef.current.refresh(latest);
    } catch {
      if (request.current === token) setFailed(true);
    } finally {
      if (request.current === token) setLoading(false);
    }
  }, [slug, sample]);
  useEffect(() => {
    setRemote(null);
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  const execute = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      Alert.alert(t("error"), t("retry"));
    } finally {
      setBusy(false);
    }
  };
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("error"), t("actionUnavailable"));
    }
  };
  const share = async () => {
    if (!card) return;
    try {
      await Share.share({
        message: `${card.displayName}\n${cardUrl(card.slug)}`,
      });
    } catch {
      Alert.alert(t("error"), t("actionUnavailable"));
    }
  };
  if (!card)
    return (
      <View style={[styles.content, { flex: 1, justifyContent: "center" }]}>
        {loading ? (
          <ActivityIndicator size="large" color={c.tint} />
        ) : (
          <>
            <Text style={{ fontSize: 24, fontWeight: "600", color: c.text }}>
              {t("unavailable")}
            </Text>
            <Copy muted>{t("unavailableBody")}</Copy>
            <Button title={t("retry")} onPress={() => void load()} />
            <Button
              title={t("wallet")}
              secondary
              onPress={() => (onRemoved ? onRemoved() : router.replace("/"))}
            />
          </>
        )}
      </View>
    );
  const checked = saved?.refreshedAt;
  return (
    <>
      {!embedded ? (
        <Stack.Screen
          options={{
            title: card.displayName,
            headerRight: () => (
              <IconButton
                label={t("share")}
                name="share"
                onPress={() =>
                  isDemo
                    ? Alert.alert(t("sample"), t("demoShare"), [
                        { text: t("cancel"), style: "cancel" },
                        { text: t("share"), onPress: () => void share() },
                      ])
                    : void share()
                }
              />
            ),
          }}
        />
      ) : null}
      <ScrollView
        ref={scroll}
        scrollEnabled={scrollEnabled}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          embedded ? { paddingHorizontal: 20, paddingTop: 12, gap: 22 } : null,
        ]}
      >
        {hero ?? <ProviderTile card={card} favorite={saved?.favorite} />}
        <Animated.View
          onLayout={({ nativeEvent }) => {
            bodyY.current = nativeEvent.layout.y;
          }}
          style={{ gap: 14, opacity: detailsOpacity }}
        >
          {card.isDemo ? <Copy muted>{t("sampleBody")}</Copy> : null}
          {failed ? (
            <View accessibilityLiveRegion="polite">
              <Copy muted>{t("offline")}</Copy>
            </View>
          ) : null}
          {saved ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Copy muted>{t("alreadySaved")}</Copy>
              <IconButton
                label={t(saved.favorite ? "unfavorite" : "favorite")}
                name={saved.favorite ? "star.fill" : "star"}
                onPress={() =>
                  void execute(() => w.favorite(card.id, !saved.favorite))
                }
              />
            </View>
          ) : (
            <Button
              title={t("save")}
              icon="plus"
              busy={busy}
              onPress={() => void execute(() => w.save(card))}
            />
          )}
          {card.description ? <Copy>{card.description}</Copy> : null}
          {card.phone || card.email || card.website || card.links.length ? (
            <Section title={t("contact")}>
              {card.phone ? (
                <Button
                  title={t("call")}
                  icon="phone"
                  onPress={() =>
                    card.isDemo
                      ? Alert.alert(t("sample"), t("demoAction"))
                      : /^\+?[0-9 ()-]{8,24}$/.test(card.phone)
                        ? void open(`tel:${card.phone.replace(/[ ()-]/g, "")}`)
                        : Alert.alert(t("error"), t("actionUnavailable"))
                  }
                />
              ) : null}
              {card.email ? (
                <Button
                  title={t("email")}
                  icon="email"
                  secondary
                  onPress={() =>
                    card.isDemo
                      ? Alert.alert(t("sample"), t("demoAction"))
                      : /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(card.email)
                        ? void open(`mailto:${encodeURIComponent(card.email)}`)
                        : Alert.alert(t("error"), t("actionUnavailable"))
                  }
                />
              ) : null}
              {card.website && safeContactUrl(card.website) ? (
                <Button
                  title={t("website")}
                  icon="globe"
                  secondary
                  onPress={() => void open(safeContactUrl(card.website)!)}
                />
              ) : null}
              {card.links
                .filter((link) => safeContactUrl(link.url))
                .map((link, index) => (
                  <Button
                    key={`${index}-${link.url}`}
                    title={link.label}
                    icon="globe"
                    secondary
                    onPress={() => void open(safeContactUrl(link.url)!)}
                  />
                ))}
            </Section>
          ) : null}
          {card.services.length ? (
            <Section title={t("services")}>
              {card.services.map((service, index) => (
                <Copy key={`${index}-${service}`}>· {service}</Copy>
              ))}
            </Section>
          ) : null}
          {!card.isDemo ? (
            <Section title={t("scope")}>
              <Copy>{routeLabels[card.route][w.language]}</Copy>
              <Copy muted>{card.scope}</Copy>
              {card.verificationLabel ? (
                <Copy muted>{card.verificationLabel}</Copy>
              ) : null}
            </Section>
          ) : null}
          {saved ? (
            <View
              onLayout={({ nativeEvent }) => {
                noteSectionY.current = nativeEvent.layout.y;
              }}
            >
              <Section title={t("notes")}>
                <TextInput
                  accessibilityLabel={t("notes")}
                  onFocus={() => {
                    noteFocused.current = true;
                    revealNote();
                  }}
                  onBlur={() => {
                    noteFocused.current = false;
                  }}
                  keyboardAppearance={c.dark ? "dark" : "light"}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t("noteHint")}
                  placeholderTextColor={c.secondary}
                  multiline
                  maxLength={4000}
                  textAlignVertical="top"
                  style={[
                    styles.input,
                    {
                      backgroundColor: c.surface,
                      color: c.text,
                      minHeight: 125,
                    },
                  ]}
                />
                <Copy muted>{t("notesPrivacy")}</Copy>
                <Button
                  title={t("noteSave")}
                  secondary
                  disabled={note === saved.note}
                  busy={busy}
                  onPress={() =>
                    void execute(async () => {
                      await w.note(card.id, note);
                      Keyboard.dismiss();
                    })
                  }
                />
              </Section>
            </View>
          ) : null}
          {!isDemo ? (
            <Section>
              {checked ? (
                <Text style={{ fontSize: 13, color: c.secondary }}>
                  {t("updated")}:{" "}
                  {new Date(checked).toLocaleString(
                    w.language === "el" ? "el-GR" : "en-GB",
                  )}
                </Text>
              ) : null}
              <Button
                title={t("refresh")}
                icon="refresh"
                secondary
                busy={loading}
                onPress={() => void load()}
              />
            </Section>
          ) : null}
          {saved ? (
            <Section>
              <Button
                title={t("remove")}
                icon="trash"
                danger
                busy={busy}
                onPress={() =>
                  Alert.alert(t("removeQuestion"), t("removeBody"), [
                    { text: t("cancel"), style: "cancel" },
                    {
                      text: t("remove"),
                      style: "destructive",
                      onPress: () =>
                        void execute(async () => {
                          await w.remove(card.id);
                          if (onRemoved) onRemoved();
                          else router.replace("/");
                        }),
                    },
                  ])
                }
              />
            </Section>
          ) : null}
          {onShowQr ? (
            <Button title={t("showQr")} secondary onPress={onShowQr} />
          ) : null}
        </Animated.View>
      </ScrollView>
    </>
  );
}
