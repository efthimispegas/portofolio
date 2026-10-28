import { useRef, type ComponentRef } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  findNodeHandle,
  useWindowDimensions,
  View,
} from "react-native";
import { router } from "expo-router";
import { type SavedCard, useWallet } from "../lib/wallet-context";
import { useTheme } from "../lib/theme";
import { useCardTransition } from "../lib/card-transition";
import { WalletCardFace } from "./wallet-card-face";
function StackCard({
  item,
  index,
  front,
  expanded,
  showDemoLabel,
}: {
  item: SavedCard;
  index: number;
  front: boolean;
  expanded: boolean;
  showDemoLabel: boolean;
}) {
  const { t, favorite } = useWallet();
  const theme = useTheme();
  const motion = useCardTransition();
  const view = useRef<ComponentRef<typeof View>>(null);
  const opener = useRef<ComponentRef<typeof View>>(null);
  const measuring = useRef(false);
  const open = () => {
    if (measuring.current) return;
    measuring.current = true;
    view.current?.measureInWindow((x, y, width, height) => {
      measuring.current = false;
      motion.open({
        card: item.card,
        frame: { x, y, width, height: Math.max(1, height - (front ? 0 : 25)) },
        showDemoLabel,
        restoreFocus: () => {
          const tag = findNodeHandle(opener.current);
          if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
        },
      });
    });
  };
  const selected = motion.selectedId === item.card.id;
  return (
    <Animated.View
      ref={view}
      collapsable={false}
      style={{
        marginTop: index === 0 ? 0 : expanded ? 16 : -25,
        zIndex: index,
        borderRadius: 24,
        shadowColor: "#172C3D",
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 10,
        shadowOpacity: theme.dark ? 0.22 : 0.08,
        elevation: 2,
        opacity: selected
          ? 0
          : motion.progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.68],
            }),
        transform: [
          {
            translateY: motion.progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, expanded || !motion.spatial ? 0 : 5],
            }),
          },
        ],
      }}
    >
      <WalletCardFace
        card={item.card}
        favorite={item.favorite}
        front={front}
        showDemoLabel={showDemoLabel}
        openRef={opener}
        onOpen={open}
        onFavorite={() =>
          void favorite(item.card.id, !item.favorite).catch(() =>
            Alert.alert(t("error"), t("retry")),
          )
        }
        onQr={() =>
          router.push({
            pathname: "/share/[slug]",
            params: { slug: item.card.slug },
          })
        }
      />
    </Animated.View>
  );
}
/** Preserve the approved stack topology; large text reveals each whole card. */
export function WalletStack({ cards }: { cards: SavedCard[] }) {
  const { fontScale } = useWindowDimensions();
  const expanded = fontScale > 1.25;
  const mixed = cards.some((item) => !item.card.isDemo);
  return (
    <View style={{ paddingBottom: 8 }}>
      {cards.map((item, index) => (
        <StackCard
          key={item.card.id}
          item={item}
          index={index}
          front={expanded || index === cards.length - 1}
          expanded={expanded}
          showDemoLabel={mixed}
        />
      ))}
    </View>
  );
}
