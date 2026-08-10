import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const aliases = [
  [
    path.join(root, "assets/images/icon.png"),
    path.join(root, "assets/images/icon.5ce628456d9c03923fddd5cc2b675220.png"),
  ],
  [
    path.join(root, "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf"),
    path.join(root, "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.4e85bc9ebe07e0340c9c4fc2f6c38908.ttf"),
  ],
];

for (const [source, target] of aliases) {
  if (existsSync(source)) copyFileSync(source, target);
}

console.log("Metro asset aliases prepared.");
