import { Stack } from "expo-router";
export default function TrainingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[moduleId]" />
      <Stack.Screen name="quiz/[moduleId]" />
    </Stack>
  );
}
