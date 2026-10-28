import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
const Context = createContext<{
  title: string | null;
  setTitle: (title: string | null) => void;
} | null>(null);
/** The wallet scroll view controls the root native navigation bar, not a drawn toolbar. */
export function InlineHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useInlineHeader() {
  const value = useContext(Context);
  if (!value) throw new Error("InlineHeaderProvider missing");
  return value;
}
