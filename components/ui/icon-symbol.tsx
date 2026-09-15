// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<Extract<SymbolViewProps["name"], string>, ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "bell.fill": "notifications",
  "clock.fill": "history",
  "calendar.badge.clock": "event-note",
  "person.fill": "person",
  "person.2.fill": "people",
  "chart.bar.fill": "bar-chart",
  "exclamationmark.triangle.fill": "warning",
  "checkmark.circle.fill": "check-circle",
  "xmark.circle.fill": "cancel",
  "arrow.left": "arrow-back",
  "plus.circle.fill": "add-circle",
  "lock.fill": "lock",
  "gearshape.fill": "settings",
  "tray.fill": "inbox",
  "square.and.pencil": "edit",
  "book.fill": "menu-book",
  "questionmark.circle.fill": "quiz",
  "phone.fill": "phone",
  "map.fill": "map",
  "sparkles": "auto-awesome",
  "message.fill": "chat",
  "envelope.fill": "email",
  "archivebox.fill": "inventory",
  "calendar": "calendar-today",
  "car.fill": "directions-car",
  "checkmark.seal.fill": "verified",
  "location.fill": "location-on",
  "star.fill": "star",
  "plus": "add",
  "trash.fill": "delete",
  "pencil": "edit",
  "checkmark": "check",
  "xmark": "close",
  "arrow.right": "arrow-forward",
  "tag.fill": "local-offer",
  "mappin.circle.fill": "place",
  "list.bullet.rectangle.fill": "view-list",
  "dollarsign.circle.fill": "attach-money",
  "creditcard.fill": "credit-card",
  "wrench.fill": "build",
  "clipboard.list.fill": "assignment",
  "person.badge.plus": "person-add",
  "trophy.fill": "emoji-events",
  "exclamationmark.dollar": "money-off",
} as unknown as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
