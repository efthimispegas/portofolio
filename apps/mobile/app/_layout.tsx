import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { WalletProvider, useWallet } from "../src/lib/wallet-context";
import { useTheme } from "../src/lib/theme";
import { WalletMotionProvider } from "../src/lib/wallet-motion";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AccessibilityThemeProvider } from "../src/lib/accessibility-theme";
function Navigation() {
  const c = useTheme();
  const { t } = useWallet();
  return (
    <>
      <StatusBar style={c.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.tint,
          headerUserInterfaceStyle: c.dark ? "dark" : "light",
          headerTitleStyle: { color: c.text },
          contentStyle: { backgroundColor: c.bg },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen
          name="index"
          // Keep the source cards measurable and animated beneath details.
          activityEnabled={false}
          options={{ headerShown: true, freezeOnBlur: false }}
        />
        <Stack.Screen
          name="selected-card"
          options={{
            presentation: "transparentModal",
            animation: "none",
            gestureEnabled: false,
            headerShown: true,
            headerTransparent: true,
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
        <Stack.Screen name="settings" options={{ title: t("settings") }} />
        <Stack.Screen
          name="add"
          options={{ presentation: "modal", title: t("add") }}
        />
        <Stack.Screen name="samples" options={{ title: t("samplesTitle") }} />
        <Stack.Screen name="card/[slug]" options={{ title: t("wallet") }} />
        <Stack.Screen name="c/[slug]" options={{ headerShown: false }} />
        <Stack.Screen
          name="share/[slug]"
          options={{ presentation: "modal", title: t("qrTitle") }}
        />
      </Stack>
    </>
  );
}
export default function RootLayout() {
  return (
    <WalletProvider>
      <AccessibilityThemeProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <WalletMotionProvider>
            <Navigation />
          </WalletMotionProvider>
        </GestureHandlerRootView>
      </AccessibilityThemeProvider>
    </WalletProvider>
  );
}
