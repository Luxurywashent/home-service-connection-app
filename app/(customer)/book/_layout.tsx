import { Stack } from "expo-router";
import { BookingProvider } from "@/lib/booking-context";

export default function BookLayout() {
  return (
    <BookingProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </BookingProvider>
  );
}
