import { createContext, useContext, useState, type ReactNode } from "react";

export type VehicleType = "sedan" | "suv" | "large_suv_van" | "truck" | "rv";

export interface BookingVehicle {
  vehicleId: string;
  year: string;
  make: string;
  model: string;
  vehicleType: VehicleType;
  color?: string | null;
  label: string; // "2022 Toyota Camry"
  rvClass?: string | null;
  rvLengthFt?: number | null;
}

export interface BookingPackage {
  id: string;
  name: string;
  price: number;
}

export interface BookingAddon {
  id: string;
  name: string;
  price: number;
}

export interface BookingAddress {
  addressId?: string;
  label: string;
  fullAddress: string;
  city: string;
}

export interface GuestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface BookingState {
  vehicle: BookingVehicle | null;
  pkg: BookingPackage | null;
  addons: BookingAddon[];
  address: BookingAddress | null;
  scheduledDate: string;
  scheduledTime: string;
  /** ID of the abandoned cart record created when customer reaches the package step */
  abandonedBookingId: string | null;
  /** Referral code applied at booking (gives 10% discount to new customer) */
  referralCode: string | null;
  /** Promo code entered by customer */
  promoCode: string | null;
  /** Discount amount from promo code */
  promoDiscount: number;
  /** Deposit payment intent ID after successful charge */
  depositPaymentIntentId: string | null;
  /** Guest contact info (only set when booking without an account) */
  guestInfo: GuestInfo | null;
}

interface BookingContextType {
  booking: BookingState;
  setVehicle: (v: BookingVehicle) => void;
  setPackage: (p: BookingPackage) => void;
  setAddons: (a: BookingAddon[]) => void;
  setAddress: (a: BookingAddress) => void;
  setDateTime: (date: string, time: string) => void;
  setAbandonedBookingId: (id: string | null) => void;
  setReferralCode: (code: string | null) => void;
  setPromoCode: (code: string | null, discount: number) => void;
  setDepositPaymentIntentId: (id: string | null) => void;
  setGuestInfo: (info: GuestInfo | null) => void;
  resetBooking: () => void;
  total: number;
  subtotal: number;
  referralDiscount: number;
  promoDiscount: number;
  depositAmount: number;
  balanceDue: number;
}

const initialState: BookingState = {
  vehicle: null,
  pkg: null,
  addons: [],
  address: null,
  scheduledDate: "",
  scheduledTime: "",
  abandonedBookingId: null,
  referralCode: null,
  promoCode: null,
  promoDiscount: 0,
  depositPaymentIntentId: null,
  guestInfo: null,
};

const BookingContext = createContext<BookingContextType>({
  booking: initialState,
  setVehicle: () => {},
  setPackage: () => {},
  setAddons: () => {},
  setAddress: () => {},
  setDateTime: () => {},
  setAbandonedBookingId: () => {},
  setReferralCode: () => {},
  setPromoCode: () => {},
  setDepositPaymentIntentId: () => {},
  setGuestInfo: () => {},
  resetBooking: () => {},
  total: 0,
  subtotal: 0,
  referralDiscount: 0,
  promoDiscount: 0,
  depositAmount: 1,
  balanceDue: 0,
});

export function BookingProvider({ children }: { children: ReactNode }) {
  const [booking, setBooking] = useState<BookingState>(initialState);

  const subtotal =
    (booking.pkg?.price ?? 0) +
    booking.addons.reduce((sum, a) => sum + a.price, 0);

  // 10% discount if a referral code is applied
  const referralDiscount = booking.referralCode
    ? Math.round(subtotal * 0.1 * 100) / 100
    : 0;

  const promoDiscount = booking.promoDiscount ?? 0;

  const total = Math.max(0, subtotal - referralDiscount - promoDiscount);

  const depositAmount = 0;
  const balanceDue = total;

  return (
    <BookingContext.Provider
      value={{
        booking,
        setVehicle: (v) => setBooking((b) => ({ ...b, vehicle: v })),
        setPackage: (p) => setBooking((b) => ({ ...b, pkg: p })),
        setAddons: (a) => setBooking((b) => ({ ...b, addons: a })),
        setAddress: (a) => setBooking((b) => ({ ...b, address: a })),
        setDateTime: (date, time) => setBooking((b) => ({ ...b, scheduledDate: date, scheduledTime: time })),
        setAbandonedBookingId: (id) => setBooking((b) => ({ ...b, abandonedBookingId: id })),
        setReferralCode: (code) => setBooking((b) => ({ ...b, referralCode: code })),
        setPromoCode: (code, discount) => setBooking((b) => ({ ...b, promoCode: code, promoDiscount: discount })),
        setDepositPaymentIntentId: (id) => setBooking((b) => ({ ...b, depositPaymentIntentId: id })),
        setGuestInfo: (info) => setBooking((b) => ({ ...b, guestInfo: info })),
        resetBooking: () => setBooking(initialState),
        total,
        subtotal,
        referralDiscount,
        promoDiscount,
        depositAmount,
        balanceDue,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useBooking() {
  return useContext(BookingContext);
}
