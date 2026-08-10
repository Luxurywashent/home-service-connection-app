import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Image, Share, Animated, Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { CustomerMessageBanner } from "@/components/customer-message-banner";
import { CalendarPicker } from "@/components/calendar-picker";

const VEHICLE_TYPES = [
  { id: "sedan", label: "Sedan / Coupe", icon: "directions-car" },
  { id: "suv", label: "SUV / Crossover", icon: "directions-car" },
  { id: "large_suv_van", label: "Large SUV / Van", icon: "airport-shuttle" },
  { id: "truck", label: "Truck", icon: "local-shipping" },
  { id: "rv", label: "RV / Motorhome / Trailer", icon: "rv-hookup" },
] as const;

const RV_CLASSES = [
  "Class A",
  "Class B",
  "Class C",
  "Fifth Wheel",
  "Bumper Pull Trailer",
] as const;

type VehicleType = "sedan" | "suv" | "large_suv_van" | "truck" | "rv";

// ── CardOnFileFields: Stripe CardField on native, manual inputs on web/Expo Go ──
function CardOnFileFields({
  cardNumber, setCardNumber, cardExpiry, setCardExpiry, cardCvc, setCardCvc,
  onCardComplete, formatCardNumber, formatExpiry, styles,
}: {
  cardNumber: string; setCardNumber: (v: string) => void;
  cardExpiry: string; setCardExpiry: (v: string) => void;
  cardCvc: string; setCardCvc: (v: string) => void;
  onCardComplete: (complete: boolean) => void;
  formatCardNumber: (t: string) => string;
  formatExpiry: (t: string) => string;
  styles: any;
}) {
  const Constants = require("expo-constants").default ?? require("expo-constants");
  const isExpoGo = Constants?.appOwnership === "expo";
  const isNative = Platform.OS !== "web" && !isExpoGo;
  let StripeCardField: React.ComponentType<{ onCardChange: (d: { complete: boolean; last4?: string }) => void; style?: object; cardStyle?: object }> | null = null;
  if (isNative) {
    try {
      const m = require("@stripe/stripe-react-native");
      StripeCardField = m.CardField ?? null;
    } catch { /* ignore */ }
  }
  if (isNative && StripeCardField) {
    return (
      <View style={{ marginBottom: 4 }}>
        <Text style={styles.fieldLabel}>Card Details</Text>
        <StripeCardField
          onCardChange={(d) => onCardComplete(d.complete)}
          style={{ height: 50, marginBottom: 12 }}
          cardStyle={{ backgroundColor: "#F9FAFB", textColor: "#1A1A1A", placeholderColor: "#9CA3AF", borderColor: "#E5E7EB", borderWidth: 1, borderRadius: 10 }}
        />
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.fieldLabel}>Card Number</Text>
      <TextInput
        value={cardNumber}
        onChangeText={(t) => { setCardNumber(formatCardNumber(t)); onCardComplete(t.replace(/\s/g, "").length >= 13); }}
        placeholder="1234 5678 9012 3456"
        placeholderTextColor="#9CA3AF"
        keyboardType="numeric"
        style={styles.input}
        maxLength={19}
        returnKeyType="next"
      />
      <View style={styles.cardRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.fieldLabel}>Expiry (MM/YY)</Text>
          <TextInput
            value={cardExpiry}
            onChangeText={(t) => setCardExpiry(formatExpiry(t))}
            placeholder="MM/YY"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            style={styles.input}
            maxLength={5}
            returnKeyType="next"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>CVC</Text>
          <TextInput
            value={cardCvc}
            onChangeText={(t) => setCardCvc(t.replace(/\D/g, "").slice(0, 4))}
            placeholder="123"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            style={styles.input}
            maxLength={4}
            returnKeyType="next"
            secureTextEntry
          />
        </View>
      </View>
    </View>
  );
}

export default function CustomerProfileScreen() {
  const router = useRouter();
  const { customer, token, loginCustomer, logoutCustomer } = useCustomerAuth();

  // Poll for active tracking token (detailer on the way)
  const { data: activeTracking } = trpc.customer.activeTracking.useQuery(
    { token: token ?? "" },
    { enabled: !!token, refetchInterval: 60000 }
  );
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activeTracking) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [activeTracking]);

  const [activeSection, setActiveSection] = useState<"vehicles" | "addresses" | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [showEditContact, setShowEditContact] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Vehicle form
  const [vYear, setVYear] = useState("");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vType, setVType] = useState<VehicleType>("sedan");
  const [vColor, setVColor] = useState("");
  const [vRvClass, setVRvClass] = useState("");
  const [vRvLength, setVRvLength] = useState("");

  // Address form
  const [aLabel, setALabel] = useState("Home");
  const [aStreet, setAStreet] = useState("");
  const [aUnit, setAUnit] = useState("");
  const [aCity, setACity] = useState("");
  const [aState, setAState] = useState("FL");
  const [aZip, setAZip] = useState("");

  // Contact edit form
  const [editEmail, setEditEmail] = useState(customer?.email ?? "");
  const [editPhone, setEditPhone] = useState(customer?.phone ?? "");

  // Card on file form
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardSaving, setCardSaving] = useState(false);
  const [cardComplete, setCardComplete] = useState(false); // Stripe CardField complete

  // Derive customerKey (same logic as deposit screen)
  const customerKey = customer
    ? (() => {
        const np = customer.phone ? customer.phone.replace(/\D/g, "").slice(-10) : null;
        if (np && np.length === 10) return `phone:${np}`;
        if (customer.email) return `email:${customer.email.toLowerCase()}`;
        return `name:${(customer.firstName + " " + customer.lastName).toLowerCase().trim()}`;
      })()
    : "";

  // Query saved cards
  const savedCardsQuery = trpc.savedCards.list.useQuery(
    { customerKey },
    { enabled: !!customerKey }
  );
  const savedCard = savedCardsQuery.data?.find((c: any) => c.isDefault) ?? savedCardsQuery.data?.[0] ?? null;

  // Mutations for saving a card
  const createSetupIntentMutation = trpc.savedCards.createSetupIntent.useMutation();
  const saveCardMutation = trpc.savedCards.saveCard.useMutation({
    onSuccess: () => {
      savedCardsQuery.refetch();
      setShowCardModal(false);
      resetCardForm();
      Alert.alert("Card Saved ✓", "Your card has been saved securely and will be used for future deposits.");
    },
    onError: (e) => Alert.alert("Error", e.message ?? "Could not save card."),
  });
  const [showReferralSection, setShowReferralSection] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);

  const customerId = customer?.customerId ?? "";
  const referralCodeQuery = trpc.referral.getMyCode.useQuery(
    { customerId },
    { enabled: !!customerId }
  );
  const pointBalanceQuery = trpc.referral.getBalance.useQuery(
    { customerId },
    { enabled: !!customerId }
  );
  const rewardTiersQuery = trpc.referral.getRewardTiers.useQuery();
  const myReferralsQuery = trpc.referral.getMyReferrals.useQuery(
    { customerId },
    { enabled: !!customerId }
  );
  const redeemMutation = trpc.referral.redeem.useMutation({
    onSuccess: () => {
      pointBalanceQuery.refetch();
      setShowRedeemModal(false);
      Alert.alert("Redeemed!", "Your reward has been submitted. Our team will apply it to your next service.");
    },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const vehiclesQuery = trpc.customer.listVehicles.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );
  const addressesQuery = trpc.customer.listAddresses.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const addVehicleMutation = trpc.customer.addVehicle.useMutation({
    onSuccess: () => { vehiclesQuery.refetch(); setShowAddVehicle(false); resetVehicleForm(); },
  });
  const deleteVehicleMutation = trpc.customer.deleteVehicle.useMutation({
    onSuccess: () => vehiclesQuery.refetch(),
  });
  const updateVehicleMutation = trpc.customer.updateVehicle.useMutation({
    onSuccess: () => { vehiclesQuery.refetch(); setShowEditVehicle(false); },
    onError: (e) => Alert.alert("Error", e.message ?? "Could not update vehicle."),
  });
  const addAddressMutation = trpc.customer.addAddress.useMutation({
    onSuccess: () => { addressesQuery.refetch(); setShowAddAddress(false); resetAddressForm(); },
  });
  const deleteAddressMutation = trpc.customer.deleteAddress.useMutation({
    onSuccess: () => addressesQuery.refetch(),
  });
  const updateAddressMutation = trpc.customer.updateAddress.useMutation({
    onSuccess: () => { addressesQuery.refetch(); setShowEditAddress(false); },
    onError: (e) => Alert.alert("Error", e.message ?? "Could not update address."),
  });
  const updateProfileMutation = trpc.customer.updateProfile.useMutation({
    onSuccess: () => {
      if (customer && token) {
        loginCustomer(token, {
          ...customer,
          email: editEmail.trim().toLowerCase(),
          phone: editPhone.trim() || null,
        });
      }
      setShowEditContact(false);
      Alert.alert("Updated", "Your contact info has been saved.");
    },
    onError: (err) => Alert.alert("Error", err.message ?? "Could not update profile."),
  });
  const uploadPhotoMutation = trpc.customer.uploadProfilePhoto.useMutation({
    onSuccess: (data) => {
      if (customer && token) {
        loginCustomer(token, { ...customer, profilePhotoUrl: data.url });
      }
    },
    onError: (err) => Alert.alert("Upload Failed", err.message ?? "Could not upload photo."),
  });

  // ── Maintenance state ──
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showWarrantyModal, setShowWarrantyModal] = useState(false);
  const [maintType, setMaintType] = useState<"oil_change"|"wiper_blades"|"tire_rotation"|"air_filter"|"brake_service"|"other">("oil_change");
  const [maintLabel, setMaintLabel] = useState("");
  const [maintDate, setMaintDate] = useState("");
  const [maintMileage, setMaintMileage] = useState("");
  const [maintNextDate, setMaintNextDate] = useState("");
  const [maintNextMileage, setMaintNextMileage] = useState("");
  const [maintNotes, setMaintNotes] = useState("");
  const [maintSaving, setMaintSaving] = useState(false);
  // Date picker state
  const [showMaintDatePicker, setShowMaintDatePicker] = useState(false);
  const [showMaintNextDatePicker, setShowMaintNextDatePicker] = useState(false);
  const [showWarrantyExpiryPicker, setShowWarrantyExpiryPicker] = useState(false);
  // Detail report modals
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedWarranty, setSelectedWarranty] = useState<any>(null);

  const [warrantyCat, setWarrantyCat] = useState<"battery"|"tire"|"brake"|"other">("battery");
  const [warrantyLabel, setWarrantyLabel] = useState("");
  const [warrantyExpiry, setWarrantyExpiry] = useState("");
  const [warrantyNotes, setWarrantyNotes] = useState("");
  const [warrantyFile, setWarrantyFile] = useState<{name:string;base64:string;mimeType:string}|null>(null);
  const [warrantySaving, setWarrantySaving] = useState(false);

  // Edit vehicle state
  const [showEditVehicle, setShowEditVehicle] = useState(false);
  const [editVehicleId, setEditVehicleId] = useState("");
  const [evYear, setEvYear] = useState("");
  const [evMake, setEvMake] = useState("");
  const [evModel, setEvModel] = useState("");
  const [evType, setEvType] = useState<VehicleType>("sedan");
  const [evColor, setEvColor] = useState("");
  const [evRvClass, setEvRvClass] = useState("");
  const [evRvLength, setEvRvLength] = useState("");

  // Edit address state
  const [showEditAddress, setShowEditAddress] = useState(false);
  const [editAddressId, setEditAddressId] = useState("");
  const [eaLabel, setEaLabel] = useState("Home");
  const [eaStreet, setEaStreet] = useState("");
  const [eaUnit, setEaUnit] = useState("");
  const [eaCity, setEaCity] = useState("");
  const [eaState, setEaState] = useState("FL");
  const [eaZip, setEaZip] = useState("");

  // Edit name state
  const [showEditName, setShowEditName] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");

  const maintenanceQuery = trpc.maintenance.listRecords.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );
  const warrantyQuery = trpc.maintenance.listWarranties.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );
  const addMaintenanceMutation = trpc.maintenance.addRecord.useMutation({
    onSuccess: () => { maintenanceQuery.refetch(); setShowMaintenanceModal(false); resetMaintForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteMaintenanceMutation = trpc.maintenance.deleteRecord.useMutation({
    onSuccess: () => maintenanceQuery.refetch(),
  });
  const uploadWarrantyMutation = trpc.maintenance.uploadWarranty.useMutation({
    onSuccess: () => { warrantyQuery.refetch(); setShowWarrantyModal(false); resetWarrantyForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteWarrantyMutation = trpc.maintenance.deleteWarranty.useMutation({
    onSuccess: () => warrantyQuery.refetch(),
  });

  function resetMaintForm() {
    setMaintType("oil_change"); setMaintLabel(""); setMaintDate("");
    setMaintMileage(""); setMaintNextDate(""); setMaintNextMileage(""); setMaintNotes("");
  }
  function resetWarrantyForm() {
    setWarrantyCat("battery"); setWarrantyLabel(""); setWarrantyExpiry("");
    setWarrantyNotes(""); setWarrantyFile(null);
  }

  async function handlePickWarrantyFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["application/pdf","image/*"], copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      setWarrantyFile({ name: asset.name, base64, mimeType: asset.mimeType ?? "application/pdf" });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not read file.");
    }
  }

  async function handleSaveMaintenance() {
    if (!maintLabel.trim() || !maintDate.trim()) {
      Alert.alert("Required", "Please enter a label and service date."); return;
    }
    setMaintSaving(true);
    try {
      await addMaintenanceMutation.mutateAsync({
        token: token ?? "",
        type: maintType,
        label: maintLabel.trim(),
        serviceDate: maintDate.trim(),
        mileageAtService: maintMileage ? parseInt(maintMileage) : undefined,
        nextServiceDate: maintNextDate.trim() || undefined,
        nextServiceMileage: maintNextMileage ? parseInt(maintNextMileage) : undefined,
        notes: maintNotes.trim() || undefined,
      });
    } finally { setMaintSaving(false); }
  }

  async function handleSaveWarranty() {
    if (!warrantyLabel.trim() || !warrantyFile) {
      Alert.alert("Required", "Please enter a label and select a file."); return;
    }
    setWarrantySaving(true);
    try {
      await uploadWarrantyMutation.mutateAsync({
        token: token ?? "",
        category: warrantyCat,
        label: warrantyLabel.trim(),
        fileBase64: warrantyFile.base64,
        fileName: warrantyFile.name,
        mimeType: warrantyFile.mimeType,
        expiryDate: warrantyExpiry.trim() || undefined,
        notes: warrantyNotes.trim() || undefined,
      });
    } finally { setWarrantySaving(false); }
  }

  function resetVehicleForm() {
    setVYear(""); setVMake(""); setVModel(""); setVType("sedan"); setVColor("");
    setVRvClass(""); setVRvLength("");
  }
  function resetAddressForm() {
    setALabel("Home"); setAStreet(""); setAUnit(""); setACity(""); setAState("FL"); setAZip("");
  }
  function resetCardForm() {
    setCardNumber(""); setCardExpiry(""); setCardCvc(""); setCardName("");
  }

  async function handlePickPhoto(source: "library" | "camera") {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Camera access is needed to take a photo.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: "images",
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.7,
          base64: true,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images",
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.7,
          base64: true,
        });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert("Error", "Could not read image data.");
        return;
      }
      setPhotoUploading(true);
      await uploadPhotoMutation.mutateAsync({
        token: token ?? "",
        imageBase64: asset.base64,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Something went wrong.");
    } finally {
      setPhotoUploading(false);
    }
  }

  function promptPhotoSource() {
    Alert.alert(
      "Vehicle Photo",
      "Set your vehicle as your profile picture",
      [
        { text: "Take Photo", onPress: () => handlePickPhoto("camera") },
        { text: "Choose from Library", onPress: () => handlePickPhoto("library") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  async function handleAddVehicle() {
    if (!vYear.trim() || !vMake.trim() || !vModel.trim()) {
      Alert.alert("Missing Info", "Please fill in year, make, and model.");
      return;
    }
    if (vType === "rv") {
      if (!vRvClass) { Alert.alert("Missing Info", "Please select an RV class."); return; }
      if (!vRvLength.trim() || isNaN(Number(vRvLength)) || Number(vRvLength) <= 0) {
        Alert.alert("Missing Info", "Please enter a valid RV length in feet."); return;
      }
    }
    await addVehicleMutation.mutateAsync({
      token: token ?? "",
      year: vYear.trim(),
      make: vMake.trim(),
      model: vModel.trim(),
      vehicleType: vType,
      color: vColor.trim() || undefined,
      rvClass: vType === "rv" ? vRvClass : undefined,
      rvLengthFt: vType === "rv" && vRvLength.trim() ? parseInt(vRvLength.trim()) : undefined,
      isDefault: (vehiclesQuery.data?.length ?? 0) === 0,
    });
  }

  async function handleAddAddress() {
    if (!aStreet.trim() || !aCity.trim() || !aZip.trim()) {
      Alert.alert("Missing Info", "Please fill in street, city, and zip.");
      return;
    }
    await addAddressMutation.mutateAsync({
      token: token ?? "",
      label: aLabel.trim(),
      street: aStreet.trim(),
      unit: aUnit.trim() || undefined,
      city: aCity.trim(),
      state: aState.trim(),
      zip: aZip.trim(),
      isDefault: (addressesQuery.data?.length ?? 0) === 0,
    });
  }

  async function handleUpdateContact() {
    const email = editEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      Alert.alert("Invalid Email", "Please enter a valid email address.");
      return;
    }
    await updateProfileMutation.mutateAsync({
      token: token ?? "",
      email,
      phone: editPhone.trim() || undefined,
    });
  }

  async function handleUpdateName() {
    const firstName = editFirstName.trim();
    const lastName = editLastName.trim();
    if (!firstName) { Alert.alert("Required", "Please enter a first name."); return; }
    await updateProfileMutation.mutateAsync({
      token: token ?? "",
      firstName,
      lastName: lastName || undefined,
    });
    if (customer && token) {
      loginCustomer(token, { ...customer, firstName, lastName: lastName || customer.lastName });
    }
    setShowEditName(false);
    Alert.alert("Updated", "Your name has been saved.");
  }

  async function handleUpdateVehicle() {
    if (!evYear.trim() || !evMake.trim() || !evModel.trim()) {
      Alert.alert("Missing Info", "Please fill in year, make, and model."); return;
    }
    if (evType === "rv") {
      if (!evRvClass) { Alert.alert("Missing Info", "Please select an RV class."); return; }
      if (!evRvLength.trim() || isNaN(Number(evRvLength)) || Number(evRvLength) <= 0) {
        Alert.alert("Missing Info", "Please enter a valid RV length in feet."); return;
      }
    }
    await updateVehicleMutation.mutateAsync({
      token: token ?? "",
      vehicleId: editVehicleId,
      year: evYear.trim(),
      make: evMake.trim(),
      model: evModel.trim(),
      vehicleType: evType,
      color: evColor.trim() || undefined,
      rvClass: evType === "rv" ? evRvClass : undefined,
      rvLengthFt: evType === "rv" && evRvLength.trim() ? parseInt(evRvLength.trim()) : undefined,
    });
  }

  async function handleUpdateAddress() {
    if (!eaStreet.trim() || !eaCity.trim() || !eaZip.trim()) {
      Alert.alert("Missing Info", "Please fill in street, city, and zip."); return;
    }
    await updateAddressMutation.mutateAsync({
      token: token ?? "",
      addressId: editAddressId,
      label: eaLabel.trim(),
      street: eaStreet.trim(),
      unit: eaUnit.trim() || null,
      city: eaCity.trim(),
      state: eaState.trim(),
      zip: eaZip.trim(),
    });
  }

  async function handleSaveCard() {
    const _constMod = await import("expo-constants");
    const Constants = (_constMod as any).default ?? _constMod;
    const isExpoGo = Constants?.appOwnership === "expo";
    const isNative = Platform.OS !== "web" && !isExpoGo;

    if (isNative) {
      // Native real build — use Stripe CardField (cardComplete must be true)
      if (!cardComplete) {
        Alert.alert("Incomplete Card", "Please complete all card fields.");
        return;
      }
    } else {
      // Web / Expo Go fallback — validate manual fields
      const rawNum = cardNumber.replace(/\s/g, "");
      if (rawNum.length < 13 || rawNum.length > 19) {
        Alert.alert("Invalid Card", "Please enter a valid card number.");
        return;
      }
      if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) {
        Alert.alert("Invalid Expiry", "Please enter expiry as MM/YY.");
        return;
      }
      if (cardCvc.length < 3) {
        Alert.alert("Invalid CVC", "Please enter a valid CVC.");
        return;
      }
    }
    if (!cardName.trim()) {
      Alert.alert("Missing Name", "Please enter the name on the card.");
      return;
    }
    if (!customerKey) {
      Alert.alert("Error", "Could not identify your account. Please sign in again.");
      return;
    }

    setCardSaving(true);
    try {
      // Step 1: Create a Stripe SetupIntent
      const setupResult = await createSetupIntentMutation.mutateAsync({
        customerKey,
        customerName: cardName.trim(),
        customerEmail: customer?.email ?? undefined,
      });

      let stripePaymentMethodId: string | null = null;
      let cardLast4: string | null = null;
      let cardBrand: string | null = null;

      if (isNative) {
        // Confirm the SetupIntent with the CardField data
        try {
          const stripeModule = require("@stripe/stripe-react-native");
          const { confirmSetupIntent, createPaymentMethod } = stripeModule;
          // First create a payment method from the CardField
          const { paymentMethod, error: pmError } = await createPaymentMethod({ paymentMethodType: "Card" });
          if (pmError) throw new Error(pmError.message);
          stripePaymentMethodId = paymentMethod?.id ?? null;
          cardLast4 = paymentMethod?.card?.last4 ?? null;
          cardBrand = paymentMethod?.card?.brand ?? null;
          // Confirm the SetupIntent to attach PM to customer
          if (setupResult.clientSecret && stripePaymentMethodId) {
            await confirmSetupIntent(setupResult.clientSecret, {
              paymentMethodType: "Card",
              paymentMethodData: { paymentMethodId: stripePaymentMethodId },
            });
          }
        } catch (e: any) {
          throw new Error(e?.message ?? "Could not tokenize card.");
        }
      } else {
        // Expo Go / Web: store manual card info (no real Stripe charge possible)
        const rawNum = cardNumber.replace(/\s/g, "");
        cardLast4 = rawNum.slice(-4);
        // Use a placeholder PM id — real charges won't work until native build
        stripePaymentMethodId = `manual_${Date.now()}`;
      }

      if (!stripePaymentMethodId) throw new Error("Could not get payment method.");

      // Step 2: Save to DB
      await saveCardMutation.mutateAsync({
        customerKey,
        customerName: cardName.trim(),
        customerEmail: customer?.email ?? undefined,
        customerPhone: customer?.phone ?? undefined,
        stripeCustomerId: setupResult.stripeCustomerId,
        stripePaymentMethodId,
        ...(cardLast4 ? { cardLast4 } : {}),
        ...(cardBrand ? { cardBrand } : {}),
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save card. Please try again.");
    } finally {
      setCardSaving(false);
    }
  }

  function confirmDeleteVehicle(vehicleId: string, label: string) {
    Alert.alert("Remove Vehicle", `Remove ${label}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteVehicleMutation.mutate({ token: token ?? "", vehicleId }) },
    ]);
  }

  function confirmDeleteAddress(addressId: string, label: string) {
    Alert.alert("Remove Address", `Remove "${label}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteAddressMutation.mutate({ token: token ?? "", addressId }) },
    ]);
  }

  function formatCardNumber(text: string) {
    const raw = text.replace(/\D/g, "").slice(0, 16);
    return raw.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(text: string) {
    const raw = text.replace(/\D/g, "").slice(0, 4);
    if (raw.length >= 3) return raw.slice(0, 2) + "/" + raw.slice(2);
    return raw;
  }

  const initials = (customer?.firstName?.[0] ?? "") + (customer?.lastName?.[0] ?? "");
  const photoUrl = customer?.profilePhotoUrl;

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Customer Message Banner */}
        <CustomerMessageBanner />

        {/* On the Way Banner */}
        {activeTracking && (
          <Animated.View style={{ transform: [{ scale: pulseAnim }], marginHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => router.push(`/(customer)/track/${activeTracking.jobId}` as any)}
              style={{
                backgroundColor: "#0057FF",
                borderRadius: 16,
                padding: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                shadowColor: "#0057FF",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.45,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name="local-shipping" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
                  {`\uD83D\uDE9A ${activeTracking.detailerName} is on the way!`}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>Tap to see live location</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </Animated.View>
        )}
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Profile</Text>
        </View>

        {/* Hero Image Section */}
        <TouchableOpacity
          style={styles.heroWrap}
          onPress={promptPhotoSource}
          activeOpacity={0.9}
          disabled={photoUploading}
        >
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={styles.heroPlaceholder}>
              <MaterialIcons name="directions-car" size={48} color="rgba(255,255,255,0.5)" />
              <Text style={styles.heroPlaceholderText}>Tap to add your vehicle photo</Text>
            </View>
          )}
          {/* Upload / loading badge */}
          <View style={styles.heroUploadBadge}>
            {photoUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialIcons name="photo-camera" size={18} color="#FFFFFF" />
            )}
            <Text style={styles.heroUploadText}>{photoUrl ? "Change Photo" : "Upload Photo"}</Text>
          </View>
        </TouchableOpacity>

        {/* Name + contact below the hero */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#1A1A1A" }}>{customer?.firstName} {customer?.lastName}</Text>
          <Text style={{ fontSize: 13, color: "#6B7280", marginTop: 3 }}>{customer?.email}{customer?.phone ? `  ·  ${customer.phone}` : ""}</Text>
        </View>

        {/* Edit Name + Contact buttons below hero */}
        <View style={[styles.editContactRow, { gap: 8 }]}>
          <TouchableOpacity
            style={styles.editContactBtn}
            onPress={() => {
              setEditFirstName(customer?.firstName ?? "");
              setEditLastName(customer?.lastName ?? "");
              setShowEditName(true);
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="badge" size={14} color="#0057FF" />
            <Text style={styles.editContactText}>Edit Name</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.editContactBtn}
            onPress={() => {
              setEditEmail(customer?.email ?? "");
              setEditPhone(customer?.phone ?? "");
              setShowEditContact(true);
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="edit" size={14} color="#0057FF" />
            <Text style={styles.editContactText}>Edit Email / Phone</Text>
          </TouchableOpacity>
        </View>

        {/* My Vehicles */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionToggle}
            onPress={() => setActiveSection(activeSection === "vehicles" ? null : "vehicles")}
            activeOpacity={0.8}
          >
            <View style={styles.sectionLeft}>
              <MaterialIcons name="directions-car" size={22} color="#1A1A1A" />
              <Text style={styles.sectionLabel}>My Vehicles</Text>
              {(vehiclesQuery.data?.length ?? 0) > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{vehiclesQuery.data?.length}</Text>
                </View>
              )}
            </View>
            <MaterialIcons
              name={activeSection === "vehicles" ? "expand-less" : "expand-more"}
              size={22} color="#9CA3AF"
            />
          </TouchableOpacity>

          {activeSection === "vehicles" && (
            <View style={styles.sectionContent}>
              {vehiclesQuery.isLoading ? (
                <ActivityIndicator size="small" color="#1A1A1A" style={{ margin: 16 }} />
              ) : vehiclesQuery.data?.length === 0 ? (
                <Text style={styles.emptyText}>No vehicles added yet.</Text>
              ) : (
                vehiclesQuery.data?.map((v) => (
                  <View key={v.vehicleId} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <MaterialIcons name="directions-car" size={18} color="#6B7280" />
                      <View style={{ marginLeft: 10 }}>
                        <Text style={styles.listItemTitle}>{v.year} {v.make} {v.model}</Text>
                        <Text style={styles.listItemSub}>
                          {VEHICLE_TYPES.find(t => t.id === v.vehicleType)?.label ?? v.vehicleType}
                          {v.vehicleType === "rv" && (v as any).rvClass ? ` · ${(v as any).rvClass}` : ""}
                          {v.vehicleType === "rv" && (v as any).rvLengthFt ? ` · ${(v as any).rvLengthFt} ft` : ""}
                          {v.color ? ` · ${v.color}` : ""}
                          {v.isDefault ? " · Default" : ""}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditVehicleId(v.vehicleId);
                          setEvYear(v.year ?? "");
                          setEvMake(v.make ?? "");
                          setEvModel(v.model ?? "");
                          setEvType((v.vehicleType as VehicleType) ?? "sedan");
                          setEvColor(v.color ?? "");
                          setEvRvClass((v as any).rvClass ?? "");
                          setEvRvLength((v as any).rvLengthFt ? String((v as any).rvLengthFt) : "");
                          setShowEditVehicle(true);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialIcons name="edit" size={18} color="#0057FF" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => confirmDeleteVehicle(v.vehicleId, `${v.year} ${v.make} ${v.model}`)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialIcons name="delete" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddVehicle(true)} activeOpacity={0.8}>
                <MaterialIcons name="add" size={18} color="#1A1A1A" />
                <Text style={styles.addBtnText}>Add Vehicle</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* My Addresses */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionToggle}
            onPress={() => setActiveSection(activeSection === "addresses" ? null : "addresses")}
            activeOpacity={0.8}
          >
            <View style={styles.sectionLeft}>
              <MaterialIcons name="location-on" size={22} color="#1A1A1A" />
              <Text style={styles.sectionLabel}>My Addresses</Text>
              {(addressesQuery.data?.length ?? 0) > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{addressesQuery.data?.length}</Text>
                </View>
              )}
            </View>
            <MaterialIcons
              name={activeSection === "addresses" ? "expand-less" : "expand-more"}
              size={22} color="#9CA3AF"
            />
          </TouchableOpacity>

          {activeSection === "addresses" && (
            <View style={styles.sectionContent}>
              {addressesQuery.isLoading ? (
                <ActivityIndicator size="small" color="#1A1A1A" style={{ margin: 16 }} />
              ) : addressesQuery.data?.length === 0 ? (
                <Text style={styles.emptyText}>No addresses saved yet.</Text>
              ) : (
                addressesQuery.data?.map((a) => (
                  <View key={a.addressId} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <MaterialIcons name="place" size={18} color="#6B7280" />
                      <View style={{ marginLeft: 10 }}>
                        <Text style={styles.listItemTitle}>{a.label}</Text>
                        <Text style={styles.listItemSub}>
                          {a.street}{a.unit ? ` ${a.unit}` : ""}, {a.city}, {a.state} {a.zip}
                          {a.isDefault ? " · Default" : ""}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditAddressId(a.addressId);
                          setEaLabel(a.label ?? "Home");
                          setEaStreet(a.street ?? "");
                          setEaUnit(a.unit ?? "");
                          setEaCity(a.city ?? "");
                          setEaState(a.state ?? "FL");
                          setEaZip(a.zip ?? "");
                          setShowEditAddress(true);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialIcons name="edit" size={18} color="#0057FF" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => confirmDeleteAddress(a.addressId, a.label)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialIcons name="delete" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddAddress(true)} activeOpacity={0.8}>
                <MaterialIcons name="add" size={18} color="#1A1A1A" />
                <Text style={styles.addBtnText}>Add Address</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Card on File */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionToggle} onPress={() => setShowCardModal(true)} activeOpacity={0.8}>
            <View style={styles.sectionLeft}>
              <MaterialIcons name="credit-card" size={22} color={savedCard ? "#059669" : "#1A1A1A"} />
              <View>
                <Text style={styles.sectionLabel}>Card on File</Text>
                {savedCard ? (
                  <Text style={{ fontSize: 12, color: "#059669", marginTop: 1, fontWeight: "600" }}>
                    ✓ {savedCard.cardBrand ? savedCard.cardBrand.charAt(0).toUpperCase() + savedCard.cardBrand.slice(1) : "Card"} ending in {savedCard.cardLast4}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>No card saved</Text>
                )}
              </View>
            </View>
            <View style={styles.addCardRow}>
              <Text style={styles.addCardText}>{savedCard ? "Update" : "Add"}</Text>
              <MaterialIcons name="chevron-right" size={20} color="#9CA3AF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Referral & Rewards */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionToggle}
            onPress={() => setShowReferralSection(!showReferralSection)}
            activeOpacity={0.8}
          >
            <View style={styles.sectionLeft}>
              <Text style={{ fontSize: 20 }}>🏆</Text>
              <View>
                <Text style={styles.sectionLabel}>Rewards & Referrals</Text>
                <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 1 }}>
                  {pointBalanceQuery.data?.balance ?? 0} pts available
                </Text>
              </View>
            </View>
            <MaterialIcons name={showReferralSection ? "expand-less" : "expand-more"} size={22} color="#9CA3AF" />
          </TouchableOpacity>
          {showReferralSection && (
            <View style={styles.sectionContent}>
              {/* Points Balance */}
              <View style={styles.referralBalanceCard}>
                <Text style={styles.referralBalanceLabel}>Your Points Balance</Text>
                <Text style={styles.referralBalanceValue}>
                  {pointBalanceQuery.data?.balance?.toLocaleString() ?? "0"}
                </Text>
                <Text style={styles.referralBalanceSub}>pts</Text>
                {(pointBalanceQuery.data?.balance ?? 0) > 0 && (
                  <TouchableOpacity
                    style={styles.redeemBtn}
                    onPress={() => setShowRedeemModal(true)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.redeemBtnText}>Redeem Points</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Reward Progress */}
              {rewardTiersQuery.data && rewardTiersQuery.data.length > 0 && (
                <View style={{ marginHorizontal: 14, marginBottom: 14 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#1A1A1A", marginBottom: 10 }}>🏆 Rewards Progress</Text>
                  {rewardTiersQuery.data.map((tier: any) => {
                    const balance = pointBalanceQuery.data?.balance ?? 0;
                    const progress = Math.min(1, balance / tier.pointCost);
                    const pct = Math.round(progress * 100);
                    const remaining = Math.max(0, tier.pointCost - balance);
                    return (
                      <View key={tier.tierId} style={{ marginBottom: 12, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: "#111827", flex: 1 }} numberOfLines={1}>{tier.name}</Text>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#0057FF", marginLeft: 8 }}>{tier.pointCost.toLocaleString()} pts</Text>
                        </View>
                        {/* Progress bar */}
                        <View style={{ height: 8, backgroundColor: "#E5E7EB", borderRadius: 4, overflow: "hidden", flexDirection: "row" }}>
                          <View style={{ height: 8, flex: progress, backgroundColor: pct >= 100 ? "#059669" : "#0057FF", borderRadius: 4 }} />
                          <View style={{ flex: 1 - progress }} />
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                          <Text style={{ fontSize: 11, color: "#6B7280" }}>{pct}% complete</Text>
                          {pct < 100 ? (
                            <Text style={{ fontSize: 11, color: "#6B7280" }}>{remaining.toLocaleString()} pts to go</Text>
                          ) : (
                            <Text style={{ fontSize: 11, color: "#059669", fontWeight: "700" }}>✓ Ready to redeem!</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Referral Code */}
              <View style={styles.referralCodeCard}>
                <Text style={styles.referralCodeLabel}>Your Referral Code</Text>
                <Text style={styles.referralCodeSub}>
                  Share your code — your friend enters it at checkout to get 10% off, and you earn 500 pts when their booking is confirmed.
                </Text>
                <View style={styles.referralCodeRow}>
                  <Text style={styles.referralCode} numberOfLines={1}>
                    {referralCodeQuery.data?.code
                      ? referralCodeQuery.data.code
                      : "Loading..."}
                  </Text>
                  <TouchableOpacity
                    style={styles.shareBtn}
                    onPress={() => {
                      const code = referralCodeQuery.data?.code;
                      if (!code) return;
                      Share.share({
                        message: `Get 10% off your first Luxury Wash On Wheels detail! Download the app and use my referral code ${code} at checkout for 10% off: https://apps.apple.com/app/luxury-wash-on-wheels/id6768833519`,
                        url: `https://apps.apple.com/app/luxury-wash-on-wheels/id6768833519`,
                      });
                    }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="share" size={16} color="#FFFFFF" />
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Referral History */}
              <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                <Text style={styles.referralHistoryTitle}>Referral History</Text>
                {myReferralsQuery.data?.length === 0 || !myReferralsQuery.data ? (
                  <Text style={styles.emptyText}>No referrals yet. Share your link to get started!</Text>
                ) : (
                  myReferralsQuery.data.map((r) => (
                    <View key={r.referralId} style={styles.referralHistoryItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.referralHistoryEmail}>
                          {(r as any).friendName || r.friendEmail || "Friend"}
                        </Text>
                        <Text style={styles.referralHistoryDate}>
                          {new Date(r.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <View style={[
                        styles.referralStatusBadge,
                        r.status === "completed" && styles.referralStatusCompleted,
                        r.status === "pending" && styles.referralStatusPending,
                      ]}>
                        <Text style={[
                          styles.referralStatusText,
                          r.status === "completed" && { color: "#059669" },
                          r.status === "pending" && { color: "#D97706" },
                        ]}>
                          {r.status === "completed" ? "✓ Earned 500 pts" : "Awaiting booking"}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </View>

        {/* Maintenance Tracker */}
        <View style={styles.section}>
          <View style={[styles.sectionToggle, { borderBottomWidth: maintenanceQuery.data?.length || warrantyQuery.data?.length ? 1 : 0, borderBottomColor: "#F0F0F0" }]}>
            <View style={styles.sectionLeft}>
              <MaterialIcons name="build" size={22} color="#F59E0B" />
              <Text style={styles.sectionLabel}>Vehicle Maintenance</Text>
            </View>
          </View>

          {/* Service Records sub-header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#6B7280", letterSpacing: 0.5 }}>SERVICE RECORDS</Text>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF3C7", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}
              onPress={() => { resetMaintForm(); setShowMaintenanceModal(true); }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={14} color="#D97706" />
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#D97706" }}>Add Record</Text>
            </TouchableOpacity>
          </View>

          {maintenanceQuery.data?.length === 0 && (
            <Text style={{ fontSize: 13, color: "#9CA3AF", paddingHorizontal: 16, paddingBottom: 12 }}>No service records yet. Tap Add Record to log your first one.</Text>
          )}
          {maintenanceQuery.data?.map((rec) => {
            const typeIcons: Record<string,string> = { oil_change: "opacity", wiper_blades: "water", tire_rotation: "sync", air_filter: "air", brake_service: "disc-full", other: "build" };
            const typeLabels: Record<string,string> = { oil_change: "Oil Change", wiper_blades: "Wiper Blades", tire_rotation: "Tire Rotation", air_filter: "Air Filter", brake_service: "Brake Service", other: "Other" };
            return (
              <TouchableOpacity key={rec.recordId} onPress={() => setSelectedRecord({ ...rec, typeLabel: typeLabels[rec.type], typeIcon: typeIcons[rec.type] })} activeOpacity={0.75} style={{ flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F9FAFB" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 2 }}>
                  <MaterialIcons name={typeIcons[rec.type] as any} size={18} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#1A1A1A" }}>{rec.label}</Text>
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 1 }}>{typeLabels[rec.type]} · {rec.serviceDate}{rec.mileageAtService ? ` · ${rec.mileageAtService.toLocaleString()} mi` : ""}</Text>
                  {rec.nextServiceDate && <Text style={{ fontSize: 11, color: "#F59E0B", marginTop: 2 }}>Next: {rec.nextServiceDate}{rec.nextServiceMileage ? ` or ${rec.nextServiceMileage.toLocaleString()} mi` : ""}</Text>}
                  {rec.notes ? <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{rec.notes}</Text> : null}
                </View>
                <TouchableOpacity
                  onPress={() => Alert.alert("Delete Record", "Remove this service record?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteMaintenanceMutation.mutate({ token: token ?? "", recordId: rec.recordId }) },
                  ])}
                  style={{ padding: 4 }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="delete-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}

          {/* Warranty Documents sub-header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, borderTopWidth: 1, borderTopColor: "#F0F0F0", marginTop: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#6B7280", letterSpacing: 0.5 }}>WARRANTY DOCUMENTS</Text>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DBEAFE", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}
              onPress={() => { resetWarrantyForm(); setShowWarrantyModal(true); }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="upload-file" size={14} color="#2563EB" />
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#2563EB" }}>Upload</Text>
            </TouchableOpacity>
          </View>

          {warrantyQuery.data?.length === 0 && (
            <Text style={{ fontSize: 13, color: "#9CA3AF", paddingHorizontal: 16, paddingBottom: 14 }}>No warranties uploaded yet. Tap Upload to add a battery, tire, or brake warranty.</Text>
          )}
          {warrantyQuery.data?.map((doc) => {
            const catIcons: Record<string,string> = { battery: "battery-charging-full", tire: "tire-repair", brake: "disc-full", other: "description" };
            const catColors: Record<string,string> = { battery: "#10B981", tire: "#6366F1", brake: "#EF4444", other: "#6B7280" };
            return (
              <TouchableOpacity key={doc.docId} onPress={() => setSelectedWarranty({ ...doc, catIcon: catIcons[doc.category], catColor: catColors[doc.category] })} activeOpacity={0.75} style={{ flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F9FAFB" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 2 }}>
                  <MaterialIcons name={catIcons[doc.category] as any} size={18} color={catColors[doc.category]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#1A1A1A" }}>{doc.label}</Text>
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 1 }}>{doc.fileName}{doc.expiryDate ? ` · Expires ${doc.expiryDate}` : ""}</Text>
                  {doc.notes ? <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{doc.notes}</Text> : null}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <MaterialIcons name="chevron-right" size={18} color="#9CA3AF" />
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation?.(); Alert.alert("Delete Warranty", "Remove this warranty document?", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteWarrantyMutation.mutate({ token: token ?? "", docId: doc.docId }) },
                    ]); }}
                    style={{ padding: 4 }}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="delete-outline" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 8 }} />
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={() => {
            Alert.alert("Sign Out", "Are you sure you want to sign out?", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign Out", style: "destructive", onPress: async () => {
                await logoutCustomer();
                router.replace("/");
              }},
            ]);
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons name="logout" size={18} color="#EF4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Delete My Profile */}
        <DeleteProfileButton token={token} onDeleted={async () => { await logoutCustomer(); router.replace("/"); }} />
      </ScrollView>

      {/* Add Vehicle Modal */}
      <Modal visible={showAddVehicle} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Vehicle</Text>
              <TouchableOpacity onPress={() => { setShowAddVehicle(false); resetVehicleForm(); }}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <FormField label="Year" value={vYear} onChangeText={setVYear} placeholder="e.g. 2022" keyboardType="numeric" />
              <FormField label="Make" value={vMake} onChangeText={setVMake} placeholder="e.g. Toyota" />
              <FormField label="Model" value={vModel} onChangeText={setVModel} placeholder="e.g. Camry" />
              <FormField label="Color (optional)" value={vColor} onChangeText={setVColor} placeholder="e.g. Silver" />
              <Text style={styles.fieldLabel}>Vehicle Type</Text>
              <View style={styles.typeGrid}>
                {VEHICLE_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.typeChip, vType === t.id && styles.typeChipActive]}
                    onPress={() => setVType(t.id as VehicleType)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.typeChipText, vType === t.id && styles.typeChipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {vType === "rv" && (
                <>
                  <Text style={styles.fieldLabel}>RV Class</Text>
                  <View style={styles.typeGrid}>
                    {RV_CLASSES.map((cls) => (
                      <TouchableOpacity
                        key={cls}
                        style={[styles.typeChip, vRvClass === cls && styles.typeChipActive]}
                        onPress={() => setVRvClass(cls)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.typeChipText, vRvClass === cls && styles.typeChipTextActive]}>{cls}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <FormField
                    label="Length (feet)"
                    value={vRvLength}
                    onChangeText={setVRvLength}
                    placeholder="e.g. 35"
                    keyboardType="numeric"
                  />
                </>
              )}
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleAddVehicle}
                disabled={addVehicleMutation.isPending}
                activeOpacity={0.85}
              >
                {addVehicleMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Vehicle</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Vehicle Modal */}
      <Modal visible={showEditVehicle} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Vehicle</Text>
              <TouchableOpacity onPress={() => setShowEditVehicle(false)}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <FormField label="Year" value={evYear} onChangeText={setEvYear} placeholder="e.g. 2022" keyboardType="numeric" />
              <FormField label="Make" value={evMake} onChangeText={setEvMake} placeholder="e.g. Toyota" />
              <FormField label="Model" value={evModel} onChangeText={setEvModel} placeholder="e.g. Camry" />
              <FormField label="Color (optional)" value={evColor} onChangeText={setEvColor} placeholder="e.g. Silver" />
              <Text style={styles.fieldLabel}>Vehicle Type</Text>
              <View style={styles.typeGrid}>
                {VEHICLE_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.typeChip, evType === t.id && styles.typeChipActive]}
                    onPress={() => setEvType(t.id as VehicleType)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.typeChipText, evType === t.id && styles.typeChipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {evType === "rv" && (
                <>
                  <Text style={styles.fieldLabel}>RV Class</Text>
                  <View style={styles.typeGrid}>
                    {RV_CLASSES.map((cls) => (
                      <TouchableOpacity
                        key={cls}
                        style={[styles.typeChip, evRvClass === cls && styles.typeChipActive]}
                        onPress={() => setEvRvClass(cls)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.typeChipText, evRvClass === cls && styles.typeChipTextActive]}>{cls}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <FormField
                    label="Length (feet)"
                    value={evRvLength}
                    onChangeText={setEvRvLength}
                    placeholder="e.g. 35"
                    keyboardType="numeric"
                  />
                </>
              )}
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleUpdateVehicle}
                disabled={updateVehicleMutation.isPending}
                activeOpacity={0.85}
              >
                {updateVehicleMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add Address Modal */}
      <Modal visible={showAddAddress} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Address</Text>
              <TouchableOpacity onPress={() => { setShowAddAddress(false); resetAddressForm(); }}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
              <Text style={styles.fieldLabel}>Label</Text>
              <View style={styles.labelRow}>
                {["Home", "Work", "Other"].map((l) => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.typeChip, aLabel === l && styles.typeChipActive]}
                    onPress={() => setALabel(l)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.typeChipText, aLabel === l && styles.typeChipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <FormField label="Street Address" value={aStreet} onChangeText={setAStreet} placeholder="123 Main St" />
              <FormField label="Unit / Apt (optional)" value={aUnit} onChangeText={setAUnit} placeholder="Apt 4B" />
              <FormField label="City" value={aCity} onChangeText={setACity} placeholder="Crestview" />
              <FormField label="State" value={aState} onChangeText={setAState} placeholder="FL" />
              <FormField label="ZIP Code" value={aZip} onChangeText={setAZip} placeholder="32536" keyboardType="numeric" returnKeyType="done" />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleAddAddress}
                disabled={addAddressMutation.isPending}
                activeOpacity={0.85}
              >
                {addAddressMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Address</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Address Modal */}
      <Modal visible={showEditAddress} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Address</Text>
              <TouchableOpacity onPress={() => setShowEditAddress(false)}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
              <Text style={styles.fieldLabel}>Label</Text>
              <View style={styles.labelRow}>
                {["Home", "Work", "Other"].map((l) => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.typeChip, eaLabel === l && styles.typeChipActive]}
                    onPress={() => setEaLabel(l)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.typeChipText, eaLabel === l && styles.typeChipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <FormField label="Street Address" value={eaStreet} onChangeText={setEaStreet} placeholder="123 Main St" />
              <FormField label="Unit / Apt (optional)" value={eaUnit} onChangeText={setEaUnit} placeholder="Apt 4B" />
              <FormField label="City" value={eaCity} onChangeText={setEaCity} placeholder="Crestview" />
              <FormField label="State" value={eaState} onChangeText={setEaState} placeholder="FL" />
              <FormField label="ZIP Code" value={eaZip} onChangeText={setEaZip} placeholder="32536" keyboardType="numeric" returnKeyType="done" />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleUpdateAddress}
                disabled={updateAddressMutation.isPending}
                activeOpacity={0.85}
              >
                {updateAddressMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Name Modal */}
      <Modal visible={showEditName} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Name</Text>
              <TouchableOpacity onPress={() => setShowEditName(false)}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <FormField label="First Name" value={editFirstName} onChangeText={setEditFirstName} placeholder="Ashley" />
              <FormField label="Last Name" value={editLastName} onChangeText={setEditLastName} placeholder="Blake" />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleUpdateName}
                disabled={updateProfileMutation.isPending}
                activeOpacity={0.85}
              >
                {updateProfileMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Name</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Contact Info Modal */}
      <Modal visible={showEditContact} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Contact Info</Text>
              <TouchableOpacity onPress={() => setShowEditContact(false)}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <Text style={styles.modalNote}>
                Updating your email or phone ensures all your jobs — including those booked by our team — appear in your portal automatically.
              </Text>
              <FormField label="Email Address" value={editEmail} onChangeText={setEditEmail} placeholder="you@example.com" keyboardType="email-address" />
              <FormField label="Phone Number" value={editPhone} onChangeText={setEditPhone} placeholder="(850) 555-0100" keyboardType="phone-pad" />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleUpdateContact}
                disabled={updateProfileMutation.isPending}
                activeOpacity={0.85}
              >
                {updateProfileMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Card on File Modal — centered pop-up */}
      <Modal visible={showCardModal} animationType="fade" transparent>
        <KeyboardAvoidingView style={styles.cardOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.cardSheet}>
            <View style={styles.cardSheetHeader}>
              <View style={styles.cardSheetTitleRow}>
                <MaterialIcons name="credit-card" size={22} color="#1A1A1A" />
                <Text style={styles.cardSheetTitle}>{savedCard ? "Update Card" : "Add Card on File"}</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowCardModal(false); resetCardForm(); setCardComplete(false); }}>
                <MaterialIcons name="close" size={22} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {savedCard && (
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#ECFDF5", borderRadius: 10, padding: 12, marginBottom: 14, gap: 8 }}>
                <MaterialIcons name="check-circle" size={18} color="#059669" />
                <Text style={{ fontSize: 13, color: "#059669", fontWeight: "600" }}>
                  {savedCard.cardBrand ? savedCard.cardBrand.charAt(0).toUpperCase() + savedCard.cardBrand.slice(1) : "Card"} ending in {savedCard.cardLast4} is saved
                </Text>
              </View>
            )}

            <Text style={styles.cardSheetNote}>
              Your card is stored securely via Stripe and used only when you authorize a charge.
            </Text>

            <CardOnFileFields
              cardNumber={cardNumber}
              setCardNumber={setCardNumber}
              cardExpiry={cardExpiry}
              setCardExpiry={setCardExpiry}
              cardCvc={cardCvc}
              setCardCvc={setCardCvc}
              onCardComplete={setCardComplete}
              formatCardNumber={formatCardNumber}
              formatExpiry={formatExpiry}
              styles={styles}
            />

            <Text style={styles.fieldLabel}>Name on Card</Text>
            <TextInput
              value={cardName}
              onChangeText={setCardName}
              placeholder="John Smith"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              autoCapitalize="words"
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.saveBtn, { marginTop: 20 }]}
              onPress={handleSaveCard}
              disabled={cardSaving}
              activeOpacity={0.85}
            >
              {cardSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>{savedCard ? "Update Card" : "Save Card"}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Redeem Points Modal */}
      <Modal visible={showRedeemModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRedeemModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Redeem Points</Text>
            <TouchableOpacity onPress={() => setShowRedeemModal(false)}>
              <MaterialIcons name="close" size={24} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
          <View style={{ padding: 20, backgroundColor: "#F0F9FF", borderRadius: 12, margin: 16 }}>
            <Text style={{ fontSize: 13, color: "#0057FF", fontWeight: "600" }}>
              Your Balance: {pointBalanceQuery.data?.balance?.toLocaleString() ?? "0"} pts
            </Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
            {rewardTiersQuery.isLoading ? (
              <ActivityIndicator color="#0057FF" style={{ marginTop: 40 }} />
            ) : rewardTiersQuery.data?.length === 0 ? (
              <Text style={[styles.emptyText, { marginTop: 40 }]}>No rewards available yet. Check back soon!</Text>
            ) : (
              rewardTiersQuery.data?.map((tier) => {
                const balance = pointBalanceQuery.data?.balance ?? 0;
                const canAfford = balance >= tier.pointCost;
                return (
                  <View
                    key={tier.tierId}
                    style={{
                      backgroundColor: canAfford ? "#FFFFFF" : "#F9FAFB",
                      borderRadius: 14,
                      padding: 16,
                      marginBottom: 12,
                      borderWidth: 1.5,
                      borderColor: canAfford ? "#DBEAFE" : "#E5E7EB",
                      opacity: canAfford ? 1 : 0.6,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 }}>{tier.name}</Text>
                        {tier.description ? (
                          <Text style={{ fontSize: 13, color: "#6B7280", lineHeight: 18, marginBottom: 8 }}>{tier.description}</Text>
                        ) : null}
                        <Text style={{ fontSize: 14, fontWeight: "700", color: "#0057FF" }}>🏆 {tier.pointCost.toLocaleString()} pts</Text>
                      </View>
                      {canAfford && (
                        <TouchableOpacity
                          style={{ backgroundColor: "#0057FF", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 100, marginLeft: 12 }}
                          onPress={() => {
                            Alert.alert(
                              "Confirm Redemption",
                              `Redeem ${tier.pointCost.toLocaleString()} pts for "${tier.name}"?`,
                              [
                                { text: "Cancel", style: "cancel" },
                                { text: "Redeem", onPress: () => redeemMutation.mutate({ customerId, tierId: tier.tierId }) },
                              ]
                            );
                          }}
                          disabled={redeemMutation.isPending}
                          activeOpacity={0.85}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "700", color: "#FFFFFF" }}>Redeem</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {!canAfford && (
                      <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
                        Need {(tier.pointCost - balance).toLocaleString()} more pts
                      </Text>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Add Maintenance Record Modal */}
      <Modal visible={showMaintenanceModal} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Service Record</Text>
              <TouchableOpacity onPress={() => { setShowMaintenanceModal(false); resetMaintForm(); }}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {/* Type picker */}
              <Text style={styles.fieldLabel}>SERVICE TYPE</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {([
                  { key: "oil_change", label: "Oil Change" },
                  { key: "wiper_blades", label: "Wiper Blades" },
                  { key: "tire_rotation", label: "Tire Rotation" },
                  { key: "air_filter", label: "Air Filter" },
                  { key: "brake_service", label: "Brake Service" },
                  { key: "other", label: "Other" },
                ] as const).map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5,
                      borderColor: maintType === t.key ? "#D97706" : "#E5E7EB",
                      backgroundColor: maintType === t.key ? "#FEF3C7" : "#F9FAFB" }}
                    onPress={() => { setMaintType(t.key); if (!maintLabel) setMaintLabel(t.label); }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: maintType === t.key ? "#D97706" : "#374151" }}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <FormField label="LABEL / DESCRIPTION" value={maintLabel} onChangeText={setMaintLabel} placeholder="e.g. Valvoline Oil Change" />
              {/* SERVICE DATE — native date picker */}
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.fieldLabel}>SERVICE DATE</Text>
                <TouchableOpacity
                  style={styles.datePickerBtn}
                  onPress={() => setShowMaintDatePicker(true)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="calendar-today" size={18} color="#6B7280" />
                  <Text style={[styles.datePickerText, !maintDate && { color: "#9CA3AF" }]}>
                    {maintDate || "Select date"}
                  </Text>
                  <MaterialIcons name="arrow-drop-down" size={20} color="#9CA3AF" />
                </TouchableOpacity>
                {showMaintDatePicker && (
                  <View style={{ marginTop: 8 }}>
                    <CalendarPicker
                      selectedDate={maintDate || ""}
                      onSelectDate={(d) => { setMaintDate(d); setShowMaintDatePicker(false); }}
                    />
                  </View>
                )}
              </View>
              <FormField label="MILEAGE AT SERVICE (optional)" value={maintMileage} onChangeText={setMaintMileage} placeholder="e.g. 45200" keyboardType="number-pad" />
              {/* NEXT SERVICE DATE — native date picker */}
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.fieldLabel}>NEXT SERVICE DATE (optional)</Text>
                <TouchableOpacity
                  style={styles.datePickerBtn}
                  onPress={() => setShowMaintNextDatePicker(true)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="event" size={18} color="#6B7280" />
                  <Text style={[styles.datePickerText, !maintNextDate && { color: "#9CA3AF" }]}>
                    {maintNextDate || "Select date (optional)"}
                  </Text>
                  {maintNextDate ? (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setMaintNextDate(""); }}>
                      <MaterialIcons name="close" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                  ) : (
                    <MaterialIcons name="arrow-drop-down" size={20} color="#9CA3AF" />
                  )}
                </TouchableOpacity>
                {showMaintNextDatePicker && (
                  <View style={{ marginTop: 8 }}>
                    <CalendarPicker
                      selectedDate={maintNextDate || ""}
                      onSelectDate={(d) => { setMaintNextDate(d); setShowMaintNextDatePicker(false); }}
                    />
                  </View>
                )}
              </View>
              <FormField label="NEXT SERVICE MILEAGE (optional)" value={maintNextMileage} onChangeText={setMaintNextMileage} placeholder="e.g. 48200" keyboardType="number-pad" />
              <FormField label="NOTES (optional)" value={maintNotes} onChangeText={setMaintNotes} placeholder="Any notes about this service..." />
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: "#D97706" }, maintSaving && { opacity: 0.6 }]}
                onPress={handleSaveMaintenance}
                disabled={maintSaving}
                activeOpacity={0.8}
              >
                {maintSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Record</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Upload Warranty Modal */}
      <Modal visible={showWarrantyModal} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Upload Warranty</Text>
              <TouchableOpacity onPress={() => { setShowWarrantyModal(false); resetWarrantyForm(); }}>
                <MaterialIcons name="close" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {/* Category picker */}
              <Text style={styles.fieldLabel}>WARRANTY TYPE</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {(["battery","tire","brake","other"] as const).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5,
                      borderColor: warrantyCat === cat ? "#2563EB" : "#E5E7EB",
                      backgroundColor: warrantyCat === cat ? "#DBEAFE" : "#F9FAFB" }}
                    onPress={() => setWarrantyCat(cat)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: warrantyCat === cat ? "#2563EB" : "#374151", textTransform: "capitalize" }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <FormField label="LABEL" value={warrantyLabel} onChangeText={setWarrantyLabel} placeholder="e.g. Goodyear Tire Warranty" />
              {/* EXPIRE DATE — native date picker */}
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.fieldLabel}>EXPIRE DATE (optional)</Text>
                <TouchableOpacity
                  style={styles.datePickerBtn}
                  onPress={() => setShowWarrantyExpiryPicker(true)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="event" size={18} color="#6B7280" />
                  <Text style={[styles.datePickerText, !warrantyExpiry && { color: "#9CA3AF" }]}>
                    {warrantyExpiry || "Select expire date (optional)"}
                  </Text>
                  {warrantyExpiry ? (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setWarrantyExpiry(""); }}>
                      <MaterialIcons name="close" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                  ) : (
                    <MaterialIcons name="arrow-drop-down" size={20} color="#9CA3AF" />
                  )}
                </TouchableOpacity>
                {showWarrantyExpiryPicker && (
                  <View style={{ marginTop: 8 }}>
                    <CalendarPicker
                      selectedDate={warrantyExpiry || ""}
                      onSelectDate={(d) => { setWarrantyExpiry(d); setShowWarrantyExpiryPicker(false); }}
                    />
                  </View>
                )}
              </View>
              <FormField label="NOTES (optional)" value={warrantyNotes} onChangeText={setWarrantyNotes} placeholder="Any notes about this warranty..." />
              {/* File picker */}
              <Text style={styles.fieldLabel}>DOCUMENT (PDF or Image)</Text>
              <TouchableOpacity
                style={{ borderWidth: 1.5, borderColor: warrantyFile ? "#2563EB" : "#E5E7EB", borderStyle: "dashed", borderRadius: 12,
                  padding: 16, alignItems: "center", gap: 6, marginBottom: 20, backgroundColor: warrantyFile ? "#EFF6FF" : "#F9FAFB" }}
                onPress={handlePickWarrantyFile}
                activeOpacity={0.8}
              >
                <MaterialIcons name={warrantyFile ? "insert-drive-file" : "upload-file"} size={28} color={warrantyFile ? "#2563EB" : "#9CA3AF"} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: warrantyFile ? "#2563EB" : "#6B7280" }}>
                  {warrantyFile ? warrantyFile.name : "Tap to select PDF or image"}
                </Text>
                {warrantyFile && (
                  <TouchableOpacity onPress={() => setWarrantyFile(null)} style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 12, color: "#EF4444" }}>Remove file</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, warrantySaving && { opacity: 0.6 }]}
                onPress={handleSaveWarranty}
                disabled={warrantySaving}
                activeOpacity={0.8}
              >
                {warrantySaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Upload Warranty</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Service Record Detail Modal ── */}
      <Modal visible={!!selectedRecord} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedRecord(null)}>
        <View style={{ flex: 1, backgroundColor: "#fff" }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#1A1A1A" }}>Service Record</Text>
            <TouchableOpacity onPress={() => setSelectedRecord(null)} style={{ padding: 4 }} activeOpacity={0.7}>
              <MaterialIcons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Type badge */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name={selectedRecord?.typeIcon as any} size={26} color="#D97706" />
              </View>
              <View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: "#1A1A1A" }}>{selectedRecord?.label}</Text>
                <Text style={{ fontSize: 13, color: "#D97706", fontWeight: "600", marginTop: 2 }}>{selectedRecord?.typeLabel}</Text>
              </View>
            </View>

            {/* Details card */}
            <View style={{ backgroundColor: "#F9FAFB", borderRadius: 14, padding: 16, gap: 14, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "600" }}>SERVICE DATE</Text>
                <Text style={{ fontSize: 14, color: "#1A1A1A", fontWeight: "700" }}>{selectedRecord?.serviceDate ?? "—"}</Text>
              </View>
              {selectedRecord?.mileageAtService != null && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "600" }}>MILEAGE AT SERVICE</Text>
                  <Text style={{ fontSize: 14, color: "#1A1A1A", fontWeight: "700" }}>{selectedRecord.mileageAtService.toLocaleString()} mi</Text>
                </View>
              )}
              {selectedRecord?.nextServiceDate && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "600" }}>NEXT SERVICE DATE</Text>
                  <Text style={{ fontSize: 14, color: "#F59E0B", fontWeight: "700" }}>{selectedRecord.nextServiceDate}</Text>
                </View>
              )}
              {selectedRecord?.nextServiceMileage != null && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "600" }}>NEXT SERVICE MILEAGE</Text>
                  <Text style={{ fontSize: 14, color: "#F59E0B", fontWeight: "700" }}>{selectedRecord.nextServiceMileage.toLocaleString()} mi</Text>
                </View>
              )}
            </View>

            {/* Notes */}
            {selectedRecord?.notes ? (
              <View style={{ backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#FDE68A", marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#92400E", marginBottom: 4 }}>NOTES</Text>
                <Text style={{ fontSize: 14, color: "#78350F", lineHeight: 20 }}>{selectedRecord.notes}</Text>
              </View>
            ) : null}

            {/* Delete button */}
            <TouchableOpacity
              onPress={() => Alert.alert("Delete Record", "Remove this service record?", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => { deleteMaintenanceMutation.mutate({ token: token ?? "", recordId: selectedRecord?.recordId }); setSelectedRecord(null); } },
              ])}
              style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="delete-outline" size={18} color="#EF4444" />
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#EF4444" }}>Delete Record</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Warranty Detail Modal ── */}
      <Modal visible={!!selectedWarranty} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedWarranty(null)}>
        <View style={{ flex: 1, backgroundColor: "#fff" }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#1A1A1A" }}>Warranty Document</Text>
            <TouchableOpacity onPress={() => setSelectedWarranty(null)} style={{ padding: 4 }} activeOpacity={0.7}>
              <MaterialIcons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Category badge */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name={selectedWarranty?.catIcon as any} size={26} color={selectedWarranty?.catColor} />
              </View>
              <View>
                <Text style={{ fontSize: 20, fontWeight: "800", color: "#1A1A1A" }}>{selectedWarranty?.label}</Text>
                <Text style={{ fontSize: 13, color: selectedWarranty?.catColor, fontWeight: "600", marginTop: 2, textTransform: "capitalize" }}>{selectedWarranty?.category} Warranty</Text>
              </View>
            </View>

            {/* Details card */}
            <View style={{ backgroundColor: "#F9FAFB", borderRadius: 14, padding: 16, gap: 14, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "600" }}>FILE NAME</Text>
                <Text style={{ fontSize: 14, color: "#1A1A1A", fontWeight: "700", flexShrink: 1, textAlign: "right", marginLeft: 12 }}>{selectedWarranty?.fileName ?? "—"}</Text>
              </View>
              {selectedWarranty?.expiryDate && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "600" }}>EXPIRY DATE</Text>
                  <Text style={{ fontSize: 14, color: "#1A1A1A", fontWeight: "700" }}>{selectedWarranty.expiryDate}</Text>
                </View>
              )}
            </View>

            {/* Warranty image / PDF viewer */}
            {selectedWarranty?.fileUrl ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 8 }}>WARRANTY DOCUMENT</Text>
                {selectedWarranty.fileUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                  <Image
                    source={{ uri: selectedWarranty.fileUrl }}
                    style={{ width: "100%", height: 320, borderRadius: 12, resizeMode: "contain", backgroundColor: "#F3F4F6" }}
                  />
                ) : (
                  <TouchableOpacity
                    onPress={() => { const { Linking } = require("react-native"); Linking.openURL(selectedWarranty.fileUrl); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#BFDBFE" }}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="picture-as-pdf" size={28} color="#2563EB" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: "#1D4ED8" }}>View PDF Document</Text>
                      <Text style={{ fontSize: 12, color: "#3B82F6", marginTop: 2 }}>Tap to open in browser</Text>
                    </View>
                    <MaterialIcons name="open-in-new" size={18} color="#3B82F6" />
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {/* Notes */}
            {selectedWarranty?.notes ? (
              <View style={{ backgroundColor: "#F0FDF4", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#BBF7D0", marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#166534", marginBottom: 4 }}>NOTES</Text>
                <Text style={{ fontSize: 14, color: "#15803D", lineHeight: 20 }}>{selectedWarranty.notes}</Text>
              </View>
            ) : null}

            {/* Delete button */}
            <TouchableOpacity
              onPress={() => Alert.alert("Delete Warranty", "Remove this warranty document?", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => { deleteWarrantyMutation.mutate({ token: token ?? "", docId: selectedWarranty?.docId }); setSelectedWarranty(null); } },
              ])}
              style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="delete-outline" size={18} color="#EF4444" />
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#EF4444" }}>Delete Warranty</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function FormField({
  label, value, onChangeText, placeholder, keyboardType = "default", returnKeyType,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any; returnKeyType?: string;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        style={styles.input}
        returnKeyType={(returnKeyType as any) || "next"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: "800", color: "#1A1A1A" },

  // ── Hero image styles ──
  heroWrap: {
    width: Dimensions.get("window").width,
    height: 220,
    backgroundColor: "#1A1A1A",
    position: "relative",
    overflow: "hidden",
    marginBottom: 0,
  },
  heroImage: { width: "100%", height: "100%" },
  heroPlaceholder: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: "#2A2A2A",
  },
  heroPlaceholderText: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: "600" },
  heroUploadBadge: {
    position: "absolute", top: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
  heroUploadText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  heroNameBlock: { position: "absolute", bottom: 14, left: 16, right: 16 },
  heroFullName: { fontSize: 22, fontWeight: "800", color: "#FFFFFF", textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  heroSub: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  editContactRow: { alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F0F0F0", marginBottom: 8 },
  editContactBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: "#DBEAFE", backgroundColor: "#EFF6FF" },
  editContactText: { fontSize: 13, fontWeight: "600", color: "#0057FF" },

  section: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1, borderColor: "#F0F0F0", overflow: "hidden" },
  sectionToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: "#FFFFFF" },
  sectionLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionLabel: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  countBadge: { backgroundColor: "#1A1A1A", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  countBadgeText: { fontSize: 11, fontWeight: "700", color: "#FFFFFF" },
  sectionContent: { borderTopWidth: 1, borderTopColor: "#F0F0F0", backgroundColor: "#FAFAFA" },

  addCardRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  addCardText: { fontSize: 13, color: "#9CA3AF", fontWeight: "500" },

  listItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  listItemLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  listItemTitle: { fontSize: 14, fontWeight: "600", color: "#1A1A1A" },
  listItemSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  emptyText: { fontSize: 14, color: "#9CA3AF", padding: 16, textAlign: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: 14, justifyContent: "center" },
  addBtnText: { fontSize: 14, fontWeight: "600", color: "#1A1A1A" },

  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "#FEE2E2" },
  signOutText: { fontSize: 15, fontWeight: "600", color: "#EF4444" },

  modal: { flex: 1, backgroundColor: "#FFFFFF" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#F0F0F0", paddingTop: 56 },
  modalTitle: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },
  modalNote: { fontSize: 13, color: "#6B7280", lineHeight: 20, marginBottom: 20, backgroundColor: "#F0F9FF", borderRadius: 10, padding: 12 },

  cardOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  cardSheet: { width: "100%", backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 10 },
  cardSheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardSheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardSheetTitle: { fontSize: 18, fontWeight: "800", color: "#1A1A1A" },
  cardSheetNote: { fontSize: 13, color: "#6B7280", lineHeight: 19, marginBottom: 20 },
  cardRow: { flexDirection: "row", marginBottom: 0 },

  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#1A1A1A", marginBottom: 16 },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  labelRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  typeChipActive: { borderColor: "#1A1A1A", backgroundColor: "#1A1A1A" },
  typeChipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  typeChipTextActive: { color: "#FFFFFF" },

  saveBtn: { backgroundColor: "#1A1A1A", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  datePickerBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  datePickerText: { flex: 1, fontSize: 15, color: "#1A1A1A" },
  datePickerDone: { alignSelf: "flex-end", marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#1A1A1A", borderRadius: 8 },
  datePickerDoneText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  // Referral & Rewards styles
  referralBalanceCard: { margin: 14, backgroundColor: "#0057FF", borderRadius: 16, padding: 20, alignItems: "center" },
  referralBalanceLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600", marginBottom: 4 },
  referralBalanceValue: { fontSize: 48, fontWeight: "800", color: "#FFFFFF", lineHeight: 56 },
  referralBalanceSub: { fontSize: 16, color: "rgba(255,255,255,0.8)", fontWeight: "600", marginBottom: 12 },
  redeemBtn: { backgroundColor: "#FFFFFF", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 100 },
  redeemBtnText: { fontSize: 14, fontWeight: "700", color: "#0057FF" },
  referralCodeCard: { marginHorizontal: 14, marginBottom: 14, backgroundColor: "#F0F9FF", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#DBEAFE" },
  referralCodeLabel: { fontSize: 14, fontWeight: "700", color: "#1A1A1A", marginBottom: 4 },
  referralCodeSub: { fontSize: 12, color: "#6B7280", lineHeight: 18, marginBottom: 12 },
  referralCodeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  referralCode: { flex: 1, fontSize: 16, fontWeight: "800", color: "#0057FF", backgroundColor: "#FFFFFF", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#DBEAFE", letterSpacing: 1.5, textAlign: "center" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#0057FF", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  shareBtnText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  referralHistoryTitle: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  referralHistoryItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  referralHistoryEmail: { fontSize: 13, fontWeight: "600", color: "#1A1A1A" },
  referralHistoryDate: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  referralStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, backgroundColor: "#F3F4F6" },
  referralStatusCompleted: { backgroundColor: "#D1FAE5" },
  referralStatusPending: { backgroundColor: "#FEF3C7" },
  referralStatusText: { fontSize: 11, fontWeight: "700", color: "#6B7280" },
});

function DeleteProfileButton({ token, onDeleted }: { token: string | null; onDeleted: () => void }) {
  const deleteAccountMutation = trpc.customer.deleteMyAccount.useMutation();

  const handleDelete = () => {
    Alert.alert(
      "Delete My Profile",
      "This will permanently delete your account, saved vehicles, and addresses. Your appointment history will be kept on file.\n\nThis action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Profile",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Are you sure?",
              "Your profile will be permanently deleted.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, Delete",
                  style: "destructive",
                  onPress: async () => {
                    if (!token) return;
                    try {
                      await deleteAccountMutation.mutateAsync({ token });
                      onDeleted();
                    } catch (e: any) {
                      Alert.alert("Error", e?.message ?? "Failed to delete profile. Please try again.");
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 32,
        padding: 14, borderRadius: 12,
      }}
      onPress={handleDelete}
      activeOpacity={0.7}
      disabled={deleteAccountMutation.isPending}
    >
      {deleteAccountMutation.isPending ? (
        <ActivityIndicator size="small" color="#9CA3AF" />
      ) : (
        <MaterialIcons name="delete-forever" size={16} color="#9CA3AF" />
      )}
      <Text style={{ fontSize: 13, color: "#9CA3AF" }}>
        {deleteAccountMutation.isPending ? "Deleting..." : "Delete My Profile"}
      </Text>
    </TouchableOpacity>
  );
}
