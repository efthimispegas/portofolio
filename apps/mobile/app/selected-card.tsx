import { Redirect } from "expo-router";

// Card details now share the wallet scene; keep old development links harmless.
export default function SelectedCardScreen() {
  return <Redirect href="/" />;
}
