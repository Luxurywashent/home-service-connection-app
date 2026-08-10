import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, double, tinyint, boolean, datetime, json, date, index } from "drizzle-orm/mysql-core";

// ─── Users table (Manus OAuth - kept for framework compatibility) ───
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Employees table ───
export const employees = mysqlTable("employees", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  pin: varchar("pin", { length: 6 }).notNull(),
  role: mysqlEnum("role", ["detailer", "admin", "office", "operations_manager", "door_hanger_rep", "sales"]).notNull(),
  city: varchar("city", { length: 128 }),
  activeStatus: mysqlEnum("active_status", ["active", "inactive"]).default("active").notNull(),
  hireDate: varchar("hire_date", { length: 32 }),
  profilePhotoUrl: text("profile_photo_url"),
  phoneNumber: varchar("phone_number", { length: 32 }),
  pushToken: text("push_token"),
  showOnBookingForm: tinyint("show_on_booking_form").default(1).notNull(), // 1 = visible to customers on booking form
  shift: mysqlEnum("shift", ["shift1", "shift2"]).default("shift1").notNull(), // shift1 = Mon-Thu, shift2 = Fri-Sun (legacy — superseded by customWorkDays when set)
  // Comma-separated JS day numbers: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  // When non-null, this overrides shift for availability. e.g. "1,2,3,4,5" = Mon–Fri
  customWorkDays: varchar("custom_work_days", { length: 32 }),
  shiftStartHour: decimal("shift_start_hour", { precision: 4, scale: 1 }).default("8.0"),  // e.g. 8.0 = 8:00 AM, 8.5 = 8:30 AM
  shiftEndHour: decimal("shift_end_hour", { precision: 4, scale: 1 }).default("17.0"),    // e.g. 17.0 = 5:00 PM
  hourlyRate: decimal("hourly_rate", { precision: 8, scale: 2 }).default("17.00"),  // $/hr for payroll & projected paycheck
  upsellBonusPct: decimal("upsell_bonus_pct", { precision: 5, scale: 2 }).default("40.00"), // % of upsell revenue paid as bonus
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = typeof employees.$inferInsert;

// ─── Daily_Performance table ───
export const dailyPerformance = mysqlTable("daily_performance", {
  id: int("id").autoincrement().primaryKey(),
  recordId: varchar("record_id", { length: 64 }).notNull().unique(),
  date: varchar("date", { length: 16 }).notNull(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  city: varchar("city", { length: 128 }),
  hoursWorked: decimal("hours_worked", { precision: 6, scale: 2 }).default("0"),
  revenueProduced: decimal("revenue_produced", { precision: 10, scale: 2 }).default("0"),
  efficiencyPercent: decimal("efficiency_percent", { precision: 5, scale: 2 }).default("0"),
  upsells: decimal("upsells", { precision: 10, scale: 2 }).default("0"),
  tips: decimal("tips", { precision: 10, scale: 2 }).default("0"),
  createdBy: varchar("created_by", { length: 64 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type DailyPerformance = typeof dailyPerformance.$inferSelect;
export type InsertDailyPerformance = typeof dailyPerformance.$inferInsert;

// ─── Notifications table ───
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  notificationId: varchar("notification_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  notificationType: mysqlEnum("notification_type", [
    "qc_issue", "write_up", "missed_step", "coaching_note", "time_off_update", "company_announcement",
    "clock_alert", "clock_check_5pm", "callback_reminder", "job_transfer", "ai_booking", "repair_request", "missed_call"
  ]).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by", { length: 255 }),
  status: mysqlEnum("status", ["unread", "read", "acknowledged"]).default("unread").notNull(),
  requiresAcknowledgment: mysqlEnum("requires_acknowledgment", ["yes", "no"]).default("no").notNull(),
  readAt: timestamp("read_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── Time_Off_Requests table ───
export const timeOffRequests = mysqlTable("time_off_requests", {
  id: int("id").autoincrement().primaryKey(),
  requestId: varchar("request_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  startDate: varchar("start_date", { length: 16 }).notNull(),
  endDate: varchar("end_date", { length: 16 }).notNull(),
  totalDaysRequested: int("total_days_requested").notNull(),
  daysNoticeGiven: int("days_notice_given").notNull(),
  reason: text("reason"),
  policyValid: mysqlEnum("policy_valid", ["yes", "no"]).notNull(),
  policyMessage: text("policy_message"),
  status: mysqlEnum("status", ["pending", "approved", "denied"]).default("pending").notNull(),
  managerNote: text("manager_note"),
  decidedBy: varchar("decided_by", { length: 255 }),
  decidedAt: timestamp("decided_at"),
});

export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type InsertTimeOffRequest = typeof timeOffRequests.$inferInsert;

// ─── Notification_Read_Log table ───
export const notificationReadLog = mysqlTable("notification_read_log", {
  id: int("id").autoincrement().primaryKey(),
  logId: varchar("log_id", { length: 64 }).notNull().unique(),
  notificationId: varchar("notification_id", { length: 64 }).notNull(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  actionType: mysqlEnum("action_type", ["read", "acknowledged"]).notNull(),
  actionTimestamp: timestamp("action_timestamp").defaultNow().notNull(),
});

export type NotificationReadLog = typeof notificationReadLog.$inferSelect;
export type InsertNotificationReadLog = typeof notificationReadLog.$inferInsert;

// ─── Quiz Questions table ───
// ─── Challenges table (groups multiple questions) ───
export const challenges = mysqlTable("challenges", {
  id: int("id").autoincrement().primaryKey(),
  challengeId: varchar("challenge_id", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 512 }).notNull(),
  prizeName: varchar("prize_name", { length: 255 }),
  prizeEmoji: varchar("prize_emoji", { length: 32 }),
  isActive: mysqlEnum("is_active", ["yes", "no"]).default("yes").notNull(),
  expiresAt: varchar("expires_at", { length: 32 }),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Challenge = typeof challenges.$inferSelect;
export type InsertChallenge = typeof challenges.$inferInsert;

export const quizQuestions = mysqlTable("quiz_questions", {
  id: int("id").autoincrement().primaryKey(),
  questionId: varchar("question_id", { length: 64 }).notNull().unique(),
  challengeId: varchar("challenge_id", { length: 64 }).notNull(),
  orderIndex: int("order_index").notNull(),
  questionText: text("question_text").notNull(),
  optionA: varchar("option_a", { length: 512 }).notNull(),
  optionB: varchar("option_b", { length: 512 }).notNull(),
  optionC: varchar("option_c", { length: 512 }).notNull(),
  optionD: varchar("option_d", { length: 512 }),
  correctAnswer: mysqlEnum("correct_answer", ["A", "B", "C", "D"]).notNull(),
  explanationCorrect: text("explanation_correct"),
  explanationIncorrect: text("explanation_incorrect"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type InsertQuizQuestion = typeof quizQuestions.$inferInsert;

// ─── Employee Progression table ───
export const employeeProgression = mysqlTable("employee_progression", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  questionId: varchar("question_id", { length: 64 }).notNull(),
  attemptResult: mysqlEnum("attempt_result", ["correct", "incorrect"]).notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  completedDate: varchar("completed_date", { length: 16 }).notNull(),
});

export type EmployeeProgression = typeof employeeProgression.$inferSelect;
export type InsertEmployeeProgression = typeof employeeProgression.$inferInsert;

// ─── Door Hanger Entries table ───
export const doorHangerEntries = mysqlTable("door_hanger_entries", {
  id: int("id").autoincrement().primaryKey(),
  entryId: varchar("entry_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  address: varchar("address", { length: 255 }).notNull(),
  city: varchar("city", { length: 128 }).notNull(),
  outreachType: mysqlEnum("outreach_type", ["door_hangers", "business_cards", "yard_signs", "table_toppers"]).notNull(),
  quantityDistributed: int("quantity_distributed").default(1).notNull(),
  notes: text("notes"),
  photoUrls: text("photo_urls"),
  latitude: double("latitude"),
  longitude: double("longitude"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DoorHangerEntry = typeof doorHangerEntries.$inferSelect;
export type InsertDoorHangerEntry = typeof doorHangerEntries.$inferInsert;

// ─── Door Hanger Goals table ───
export const doorHangerGoals = mysqlTable("door_hanger_goals", {
  id: int("id").autoincrement().primaryKey(),
  goalId: varchar("goal_id", { length: 64 }).notNull().unique(),
  // Daily goals for each outreach type
  dailyDoorHangerGoal: int("daily_door_hanger_goal").default(50).notNull(),
  dailyBusinessCardGoal: int("daily_business_card_goal").default(20).notNull(),
  dailyYardSignGoal: int("daily_yard_sign_goal").default(2).notNull(),
  dailyTableTopperGoal: int("daily_table_topper_goal").default(5).notNull(),
  updatedBy: varchar("updated_by", { length: 64 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type DoorHangerGoals = typeof doorHangerGoals.$inferSelect;
export type InsertDoorHangerGoals = typeof doorHangerGoals.$inferInsert;

// ─── Training Modules table ───
export const trainingModules = mysqlTable("training_modules", {
  id: int("id").autoincrement().primaryKey(),
  moduleId: varchar("module_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 64 }),
  videoUrl: varchar("video_url", { length: 512 }),
  quizTitle: varchar("quiz_title", { length: 255 }),
  orderIndex: int("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrainingModule = typeof trainingModules.$inferSelect;
export type InsertTrainingModule = typeof trainingModules.$inferInsert;

// ─── Training Tools table ───
export const trainingTools = mysqlTable("training_tools", {
  id: int("id").autoincrement().primaryKey(),
  toolId: varchar("tool_id", { length: 64 }).notNull().unique(),
  moduleId: varchar("module_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  orderIndex: int("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrainingTool = typeof trainingTools.$inferSelect;
export type InsertTrainingTool = typeof trainingTools.$inferInsert;

// ─── Training Steps table ───
export const trainingSteps = mysqlTable("training_steps", {
  id: int("id").autoincrement().primaryKey(),
  stepId: varchar("step_id", { length: 64 }).notNull().unique(),
  moduleId: varchar("module_id", { length: 64 }).notNull(),
  orderIndex: int("order_index").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  videoUrl: varchar("video_url", { length: 512 }),
  warnings: text("warnings"),
  tips: text("tips"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrainingStep = typeof trainingSteps.$inferSelect;
export type InsertTrainingStep = typeof trainingSteps.$inferInsert;

// ─── User Training Progress table ───
export const userTrainingProgress = mysqlTable("user_training_progress", {
  id: int("id").autoincrement().primaryKey(),
  progressId: varchar("progress_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  moduleId: varchar("module_id", { length: 64 }).notNull(),
  completedSteps: text("completed_steps"),
  isModuleCompleted: mysqlEnum("is_module_completed", ["yes", "no"]).default("no").notNull(),
  completedAt: timestamp("completed_at"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type UserTrainingProgress = typeof userTrainingProgress.$inferSelect;
export type InsertUserTrainingProgress = typeof userTrainingProgress.$inferInsert;

// ─── Team Chat Messages table ───
export const teamChatMessages = mysqlTable("team_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("message_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  profilePhotoUrl: text("profile_photo_url"),
  messageText: text("message_text"),
  imageUrl: text("image_url"),
  // audioUrl: set for push-to-talk voice messages
  audioUrl: text("audio_url"),
  // durationSeconds: voice message duration
  durationSeconds: int("duration_seconds"),
  // channel: 'general' | 'admin' | 'detailers' | 'sales' | 'door_hangers' | 'dm' | 'ptt'
  channel: varchar("channel", { length: 64 }).default("general").notNull(),
  // recipientId: set when channel = 'dm'
  recipientId: varchar("recipient_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type TeamChatMessage = typeof teamChatMessages.$inferSelect;
export type InsertTeamChatMessage = typeof teamChatMessages.$inferInsert;


// ─── Clock In/Out Records table ───
// ─── Schedule Blockers table ───
export const scheduleBlockers = mysqlTable("schedule_blockers", {
  id: varchar("id", { length: 36 }).notNull().primaryKey(),
  detailerName: varchar("detailer_name", { length: 100 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  startHour: decimal("start_hour", { precision: 4, scale: 2 }).notNull().default("8.00"),
  endHour: decimal("end_hour", { precision: 4, scale: 2 }).notNull().default("17.00"),
  allDay: tinyint("all_day").notNull().default(1),
  reason: varchar("reason", { length: 255 }).notNull().default("Day Off"),
  createdBy: varchar("created_by", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type ScheduleBlocker = typeof scheduleBlockers.$inferSelect;
export type InsertScheduleBlocker = typeof scheduleBlockers.$inferInsert;

export const clockInOutRecords = mysqlTable("clock_in_out_records", {
  id: int("id").autoincrement().primaryKey(),
  recordId: varchar("record_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  clockInTime: timestamp("clock_in_time"),
  clockOutTime: timestamp("clock_out_time"),
  totalHours: decimal("total_hours", { precision: 6, scale: 2 }).default("0"),
  status: mysqlEnum("status", ["clocked_in", "clocked_out"]).default("clocked_out").notNull(),
  clockInLat: decimal("clock_in_lat", { precision: 10, scale: 7 }),
  clockInLng: decimal("clock_in_lng", { precision: 10, scale: 7 }),
  clockOutLat: decimal("clock_out_lat", { precision: 10, scale: 7 }),
  clockOutLng: decimal("clock_out_lng", { precision: 10, scale: 7 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ClockInOutRecord = typeof clockInOutRecords.$inferSelect;
export type InsertClockInOutRecord = typeof clockInOutRecords.$inferInsert;

// ─── Break Records table ───
export const breakRecords = mysqlTable("break_records", {
  id: int("id").autoincrement().primaryKey(),
  breakId: varchar("break_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  breakType: mysqlEnum("break_type", ["morning_15min", "afternoon_15min", "lunch_30min"]).notNull(),
  breakStartTime: timestamp("break_start_time"),
  breakEndTime: timestamp("break_end_time"),
  durationMinutes: int("duration_minutes").notNull(),
  status: mysqlEnum("status", ["pending", "taken", "skipped"]).default("pending").notNull(),
  notificationSent: mysqlEnum("notification_sent", ["yes", "no"]).default("no").notNull(),
  breakStartLat: decimal("break_start_lat", { precision: 10, scale: 7 }),
  breakStartLng: decimal("break_start_lng", { precision: 10, scale: 7 }),
  breakEndLat: decimal("break_end_lat", { precision: 10, scale: 7 }),
  breakEndLng: decimal("break_end_lng", { precision: 10, scale: 7 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type BreakRecord = typeof breakRecords.$inferSelect;
export type InsertBreakRecord = typeof breakRecords.$inferInsert;

// ─── Online Bookings table (from WordPress booking form or customer app) ───
export const onlineBookings = mysqlTable("online_bookings", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: varchar("booking_id", { length: 64 }).notNull().unique(),
  location: varchar("location", { length: 128 }).notNull(), // crestview | niceville | destin | fwb
  // Customer info
  firstName: varchar("first_name", { length: 128 }).notNull(),
  lastName: varchar("last_name", { length: 128 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  // Address
  streetAddress: varchar("street_address", { length: 255 }),
  unit: varchar("unit", { length: 64 }),
  city: varchar("city", { length: 128 }),
  state: varchar("state", { length: 64 }),
  zipCode: varchar("zip_code", { length: 16 }),
  // Service
  vehicleType: varchar("vehicle_type", { length: 64 }),
  packageType: varchar("package_type", { length: 64 }),
  selectedAddons: text("selected_addons"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }),
  discountCode: varchar("discount_code", { length: 64 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  finalTotal: decimal("final_total", { precision: 10, scale: 2 }),
  // Scheduling (stored in CST)
  bookingDate: varchar("booking_date", { length: 16 }).notNull(), // YYYY-MM-DD in CST
  timeSlot: varchar("time_slot", { length: 64 }).notNull(),       // e.g. "8:00am - 10:00am"
  startHour: decimal("start_hour", { precision: 4, scale: 1 }),    // 8.0 for 8am, 8.5 for 8:30am
  endHour: decimal("end_hour", { precision: 4, scale: 1 }),          // 10.0 for 10am
  // Preferred detailer (optional — set when customer selects a specific team member)
  preferredDetailerId: varchar("preferred_detailer_id", { length: 64 }),
  preferredDetailerName: varchar("preferred_detailer_name", { length: 255 }),
  // Assigned detailer (set by server after booking is saved)
  assignedTo: varchar("assigned_to", { length: 255 }),
  // Status & pipeline
  status: mysqlEnum("status", ["abandoned", "pending", "confirmed", "en_route", "in_progress", "completed", "follow_up_sent", "closed", "cancelled"]).default("confirmed").notNull(),
  pipelineNotes: text("pipeline_notes"),
  // Source tracking
  sourceUrl: varchar("source_url", { length: 512 }),
  webhookPayload: text("webhook_payload"), // raw JSON for debugging
  // Abandoned cart resume token — unique token used to pre-fill the booking form when customer returns
  resumeToken: varchar("resume_token", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type OnlineBooking = typeof onlineBookings.$inferSelect;
export type InsertOnlineBooking = typeof onlineBookings.$inferInsert;

// ─── Sales Callbacks table ───
export const salesCallbacks = mysqlTable("sales_callbacks", {
  id: int("id").autoincrement().primaryKey(),
  callbackId: varchar("callback_id", { length: 64 }).notNull().unique(),
  // Assigned sales rep
  assignedTo: varchar("assigned_to", { length: 64 }).notNull(), // employeeId
  assignedToName: varchar("assigned_to_name", { length: 255 }),
  // Prospect info
  prospectFirstName: varchar("prospect_first_name", { length: 128 }).notNull(),
  prospectLastName: varchar("prospect_last_name", { length: 128 }).notNull(),
  prospectPhone: varchar("prospect_phone", { length: 32 }).notNull(),
  prospectEmail: varchar("prospect_email", { length: 320 }),
  // Scheduling
  scheduledAt: timestamp("scheduled_at").notNull(),         // exact datetime in UTC
  timezone: varchar("timezone", { length: 64 }).default("America/Chicago").notNull(),
  notes: text("notes"),
  // Status
  status: mysqlEnum("status", ["scheduled", "completed", "missed", "cancelled", "rescheduled"]).default("scheduled").notNull(),
  completedAt: timestamp("completed_at"),
  outcome: text("outcome"),
  // GHL integration
  ghlTriggered: mysqlEnum("ghl_triggered", ["yes", "no", "failed"]).default("no").notNull(),
  ghlTriggeredAt: timestamp("ghl_triggered_at"),
  ghlPayload: text("ghl_payload"),
  ghlResponse: text("ghl_response"),
  // Reminder
  reminderSent: mysqlEnum("reminder_sent", ["yes", "no"]).default("no").notNull(),
  reminderSentAt: timestamp("reminder_sent_at"),
  // Source tracking
  source: mysqlEnum("source_callback", ["sales_rep", "detailer_referral", "portal", "manual"]).default("sales_rep").notNull(),
  referredBy: varchar("referred_by", { length: 64 }),       // employeeId of the detailer who submitted the referral
  referredByName: varchar("referred_by_name", { length: 128 }), // display name of the detailer
  // Metadata
  createdBy: varchar("created_by", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type SalesCallback = typeof salesCallbacks.$inferSelect;
export type InsertSalesCallback = typeof salesCallbacks.$inferInsert;

// ─── Schedule Jobs table (manually created + synced jobs) ───
export const scheduleJobs = mysqlTable("schedule_jobs", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull().unique(),       // client-generated UUID
  // Location / scheduling
  location: varchar("location", { length: 64 }).notNull(),           // city slug e.g. "destin"
  date: varchar("date", { length: 16 }).notNull(),                   // YYYY-MM-DD
  timeSlot: varchar("time_slot", { length: 64 }),                    // e.g. "8:00am - 10:00am"
  startHour: decimal("start_hour", { precision: 4, scale: 1 }),
  endHour: decimal("end_hour", { precision: 4, scale: 1 }),
  // Customer info
  customerId: varchar("customer_id", { length: 64 }),               // FK → customers.customer_id (auto-linked on job save)
  customerName: varchar("customer_name", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 32 }),
  customerEmail: varchar("customer_email", { length: 320 }),
  // Vehicle info
  vehicleType: varchar("vehicle_type", { length: 64 }),
  vehicleColor: varchar("vehicle_color", { length: 64 }),
  vehicleYear: varchar("vehicle_year", { length: 8 }),
  vehicleMake: varchar("vehicle_make", { length: 64 }),
  vehicleModel: varchar("vehicle_model", { length: 64 }),
  // Service info
  packageType: varchar("package_type", { length: 64 }),
  serviceDescription: text("service_description"),
  selectedAddons: text("selected_addons"),                           // JSON array string
  addonQtys: text("addon_qtys"),                                      // JSON object: addonId -> quantity for primary vehicle
  customPrice: decimal("custom_price", { precision: 10, scale: 2 }),  // per-booking price override (admin only)
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }),
  tips: decimal("tips", { precision: 10, scale: 2 }).default("0"),
  upsellTotal: decimal("upsell_total", { precision: 10, scale: 2 }).default("0"),  // total $ value of all upsell add-ons
  upsellIds: text("upsell_ids"),                                    // JSON array of addon IDs upsold on this job
  upsellQtys: text("upsell_qtys"),                                  // JSON object of addonId -> quantity
  // Assignment
  assignedTo: varchar("assigned_to", { length: 255 }),              // detailer name or employeeId
  // Status
  status: mysqlEnum("status", ["pending", "confirmed", "in_progress", "completed", "cancelled"]).default("confirmed").notNull(),
  // Source: "manual" = created in app, "online" = came from booking form (mirrored)
  source: mysqlEnum("source", ["manual", "online", "portal_app", "vip_credit"]).default("manual").notNull(),
  onlineBookingId: varchar("online_booking_id", { length: 64 }),    // ref to online_bookings.booking_id if source=online
  // Notes
  notes: text("notes"),
  customerAddress: varchar("customer_address", { length: 512 }),    // full address for Street View hero
  // Enhanced job detail fields
  privateNotes: text("private_notes"),                             // JSON array of {id, authorId, authorName, text, createdAt, updatedAt}
  tags: text("tags"),                                              // JSON array of tag strings
  leadSource: varchar("lead_source", { length: 128 }),             // auto-populated: "Online Booking", "Admin — Manual"
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0"),
  discountCode: varchar("discount_code", { length: 64 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }).default("0"),
  additionalVehicles: text("additional_vehicles"),                 // JSON: [{vehicleType, packageId, addonIds, addonQtys, price}]
  photoUrls: text("photo_urls"),                                    // JSON array of S3 URLs uploaded by detailers
  videoUrls: text("video_urls"),                                    // JSON array of S3 video URLs uploaded by detailers
  recommendedServices: text("recommended_services"),               // JSON array of addon IDs recommended by detailer after job
  createdBy: varchar("created_by", { length: 64 }),                 // employeeId who created
  // Recurrence
  recurrenceRule: text("recurrence_rule"),                           // JSON: {type, interval, dayOfWeek, ordinal, endDate}
  recurrenceParentId: varchar("recurrence_parent_id", { length: 64 }), // jobId of the parent recurring job
  // Payment record — populated when admin collects payment
  paymentMethod: varchar("payment_method", { length: 32 }),            // "credit_debit" | "cash" | "check" | "other"
  paymentIntentId: varchar("payment_intent_id", { length: 128 }),      // Stripe PaymentIntent ID (if card)
  paymentSubtotal: decimal("payment_subtotal", { precision: 10, scale: 2 }),
  paymentTip: decimal("payment_tip", { precision: 10, scale: 2 }),
  paymentTotal: decimal("payment_total", { precision: 10, scale: 2 }),
  paymentPaidAt: varchar("payment_paid_at", { length: 64 }),           // ISO timestamp string
  paymentSignatureUrl: text("payment_signature_url"),                  // base64 SVG data URL
  paymentReferenceNote: varchar("payment_reference_note", { length: 255 }),
  // Appointment confirmation
  apptConfirmationStatus: mysqlEnum("appt_confirmation_status", ["pending", "confirmed", "no_response"]).default("pending"),
  apptReminderSent: tinyint("appt_reminder_sent").default(0),
  apptReminderSentAt: datetime("appt_reminder_sent_at"),
  apptConfirmedAt: datetime("appt_confirmed_at"),
  apptConfirmToken: varchar("appt_confirm_token", { length: 64 }),
  apptConfirmMethod: mysqlEnum("appt_confirm_method", ["email", "sms"]),
  // Drive time tracking — stamped when detailer taps On My Way / Arrived
  // New customer flag — toggled by admin at booking time to alert detailers
  isNewCustomer: tinyint("is_new_customer").default(0),
  onMyWayAt: datetime("on_my_way_at"),   // when detailer tapped On My Way
  arrivedAt: datetime("arrived_at"),      // when detailer tapped Arrived
  finishedAt: datetime("finished_at"),    // when detailer tapped Finish
  // Invoice columns — managed by invoiceRouter.ts via raw SQL
  invoiceToken: varchar("invoice_token", { length: 128 }),
  invoiceSentAt: datetime("invoice_sent_at"),
  invoicePaidAt: datetime("invoice_paid_at"),
  invoicePaymentIntentId: varchar("invoice_payment_intent_id", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type ScheduleJob = typeof scheduleJobs.$inferSelect;
export type InsertScheduleJob = typeof scheduleJobs.$inferInsert;

// ─── Detailer Live Locations table ─────────────────────────────────────────────────────
// One row per detailer — upserted every 30s while they are on the way to a job.
// Cleared when they tap Arrived or clock out.
export const detailerLocations = mysqlTable("detailer_locations", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }),
  lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
  jobId: varchar("job_id", { length: 64 }),           // which job they are heading to
  customerAddress: varchar("customer_address", { length: 512 }),  // destination address for fleet map callout
  status: mysqlEnum("status", ["on_my_way", "arrived", "inactive", "clocked_in"]).default("on_my_way").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type DetailerLocation = typeof detailerLocations.$inferSelect;
export type InsertDetailerLocation = typeof detailerLocations.$inferInsert;

// ─── Tracking Tokens table ───────────────────────────────────────────────────────────────────
// Short-lived tokens sent to customers so they can view a single van’s location.
// Token expires 30 minutes after creation or when detailer taps Arrived.
export const trackingTokens = mysqlTable("tracking_tokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 32 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  jobId: varchar("job_id", { length: 64 }).notNull(),
  // Customer destination (for the map pin)
  customerAddress: varchar("customer_address", { length: 512 }),
  customerLat: decimal("customer_lat", { precision: 10, scale: 7 }),
  customerLng: decimal("customer_lng", { precision: 10, scale: 7 }),
  customerName: varchar("customer_name", { length: 255 }),
  detailerName: varchar("detailer_name", { length: 255 }),
  expiresAt: timestamp("expires_at").notNull(),
  active: mysqlEnum("active", ["yes", "no"]).default("yes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrackingToken = typeof trackingTokens.$inferSelect;
export type InsertTrackingToken = typeof trackingTokens.$inferInsert;

// ─── Morning Meeting Config table ───
export const morningMeetingConfig = mysqlTable("morning_meeting_config", {
  id: int("id").autoincrement().primaryKey(),
  zoomLink: text("zoom_link").notNull(),
  meetingTime: varchar("meeting_time", { length: 16 }).default("07:30").notNull(), // HH:MM format
  enabled: mysqlEnum("enabled", ["yes", "no"]).default("yes").notNull(),
  updatedBy: varchar("updated_by", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type MorningMeetingConfig = typeof morningMeetingConfig.$inferSelect;
export type InsertMorningMeetingConfig = typeof morningMeetingConfig.$inferInsert;

// ─── Sales Performance table ───────────────────────────────────────────────────────────────────
// One row per sales rep per day. Auto-incremented when they book a job.
export const salesPerformance = mysqlTable("sales_performance", {
  id: int("id").autoincrement().primaryKey(),
  recordId: varchar("record_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  date: varchar("date", { length: 16 }).notNull(), // YYYY-MM-DD in CST
  jobsBooked: int("jobs_booked").default(0).notNull(),
  revenueScheduled: decimal("revenue_scheduled", { precision: 10, scale: 2 }).default("0").notNull(),
  // Reference to the job that triggered this record (for audit)
  lastJobId: varchar("last_job_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type SalesPerformance = typeof salesPerformance.$inferSelect;
export type InsertSalesPerformance = typeof salesPerformance.$inferInsert;

// ─── Door Hanger Earnings table ───────────────────────────────────────────────────────────────────
// Tracks weekly earnings for door hangers: $0.25 per photo
// One row per sales rep per week (Mon-Sun)
export const doorHangerEarnings = mysqlTable("door_hanger_earnings", {
  id: int("id").autoincrement().primaryKey(),
  recordId: varchar("record_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  weekStartDate: varchar("week_start_date", { length: 16 }).notNull(), // YYYY-MM-DD (Monday of the week)
  photoCount: int("photo_count").default(0).notNull(), // Total photos uploaded this week
  totalEarnings: decimal("total_earnings", { precision: 10, scale: 2 }).default("0").notNull(), // photoCount * 0.25
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type DoorHangerEarnings = typeof doorHangerEarnings.$inferSelect;
export type InsertDoorHangerEarnings = typeof doorHangerEarnings.$inferInsert;


// ─── Customer Attachments table ───────────────────────────────────────────────
// Stores photos/files attached to a customer profile
export const customerAttachments = mysqlTable("customer_attachments", {
  id: int("id").autoincrement().primaryKey(),
  attachmentId: varchar("attachment_id", { length: 64 }).notNull().unique(), // client UUID
  // Customer identity (denormalized — customers don't have their own table row)
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 32 }),
  customerEmail: varchar("customer_email", { length: 320 }),
  // File info
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),          // S3 public URL
  fileKey: varchar("file_key", { length: 512 }), // S3 key for deletion
  mimeType: varchar("mime_type", { length: 128 }),
  fileSizeBytes: int("file_size_bytes"),
  // Metadata
  caption: varchar("caption", { length: 512 }),
  uploadedBy: varchar("uploaded_by", { length: 255 }), // employee name
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CustomerAttachment = typeof customerAttachments.$inferSelect;
export type InsertCustomerAttachment = typeof customerAttachments.$inferInsert;

// ─── Estimates table ──────────────────────────────────────────────────────────
export const estimates = mysqlTable("estimates", {
  id: int("id").autoincrement().primaryKey(),
  estimateId: varchar("estimate_id", { length: 64 }).notNull().unique(), // client UUID
  estimateNumber: int("estimate_number"),
  // Customer info (denormalized)
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 32 }),
  customerEmail: varchar("customer_email", { length: 320 }),
  customerAddress: varchar("customer_address", { length: 512 }),
  // Vehicle info
  vehicleYear: varchar("vehicle_year", { length: 8 }),
  vehicleMake: varchar("vehicle_make", { length: 64 }),
  vehicleModel: varchar("vehicle_model", { length: 64 }),
  vehicleColor: varchar("vehicle_color", { length: 64 }),
  // Estimate details
  lineItems: text("line_items").notNull(),       // JSON: [{description, qty, unitPrice, total}]
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).default("0").notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 4 }).default("0"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0").notNull(),
  // Status
  status: mysqlEnum("status", ["draft", "sent", "viewed", "accepted", "declined", "expired"]).default("draft").notNull(),
  notes: text("notes"),
  internalNotes: text("internal_notes"),
  validUntil: varchar("valid_until", { length: 16 }), // YYYY-MM-DD
  // Tracking
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = typeof estimates.$inferInsert;

// ─── AI Receptionist Call Logs table ───
export const receptionistCallLogs = mysqlTable("receptionist_call_logs", {
  id: int("id").autoincrement().primaryKey(),
  callId: varchar("call_id", { length: 64 }).notNull().unique(),
  callSid: varchar("call_sid", { length: 128 }),
  callerNumber: varchar("caller_number", { length: 32 }),
  outcome: mysqlEnum("outcome", ["booked", "inquiry", "no_booking", "failed"]).default("inquiry").notNull(),
  bookingId: varchar("booking_id", { length: 64 }),
  summary: text("summary"),
  transcript: text("transcript"),
  recordingUrl: varchar("recording_url", { length: 512 }),
  callerName: varchar("caller_name", { length: 128 }),
  durationSeconds: int("duration_seconds"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReceptionistCallLog = typeof receptionistCallLogs.$inferSelect;
export type InsertReceptionistCallLog = typeof receptionistCallLogs.$inferInsert;

// ─── Community Posts ──────────────────────────────────────────────────────────
export const communityPosts = mysqlTable("community_posts", {
  id: int("id").autoincrement().primaryKey(),
  postId: varchar("post_id", { length: 64 }).notNull().unique(),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  authorName: varchar("author_name", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  category: varchar("category", { length: 64 }).default("General"),
  isPinned: int("is_pinned").default(0).notNull(),
  likeCount: int("like_count").default(0).notNull(),
  commentCount: int("comment_count").default(0).notNull(),
  mediaUrls: text("media_urls"),                                    // JSON array of S3 URLs (images + videos)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CommunityPost = typeof communityPosts.$inferSelect;
export type InsertCommunityPost = typeof communityPosts.$inferInsert;

export const communityComments = mysqlTable("community_comments", {
  id: int("id").autoincrement().primaryKey(),
  commentId: varchar("comment_id", { length: 64 }).notNull().unique(),
  postId: varchar("post_id", { length: 64 }).notNull(),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  authorName: varchar("author_name", { length: 255 }).notNull(),
  body: text("body").notNull(),
  likeCount: int("like_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CommunityComment = typeof communityComments.$inferSelect;
export type InsertCommunityComment = typeof communityComments.$inferInsert;

export const communityPostLikes = mysqlTable("community_post_likes", {
  id: int("id").autoincrement().primaryKey(),
  postId: varchar("post_id", { length: 64 }).notNull(),
  employeeId: varchar("employee_id", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CommunityPostLike = typeof communityPostLikes.$inferSelect;

// ─── Inventory: Categories ────────────────────────────────────────────────────
export const inventoryCategories = mysqlTable("inventory_categories", {
  id: int("id").autoincrement().primaryKey(),
  categoryId: varchar("category_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InventoryCategory = typeof inventoryCategories.$inferSelect;
export type InsertInventoryCategory = typeof inventoryCategories.$inferInsert;

// ─── Inventory: Items (catalog) ──────────────────────────────────────────────
export const inventoryItems = mysqlTable("inventory_items", {
  id: int("id").autoincrement().primaryKey(),
  itemId: varchar("item_id", { length: 64 }).notNull().unique(),
  categoryId: varchar("category_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  minThreshold: int("min_threshold").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = typeof inventoryItems.$inferInsert;

// ─── Inventory: Stock Levels ──────────────────────────────────────────────────
export const inventoryStock = mysqlTable("inventory_stock", {
  id: int("id").autoincrement().primaryKey(),
  stockId: varchar("stock_id", { length: 64 }).notNull().unique(),
  itemId: varchar("item_id", { length: 64 }).notNull(),
  locationType: mysqlEnum("location_type", ["warehouse", "location", "van"]).notNull(),
  locationId: varchar("location_id", { length: 64 }).notNull(),
  quantity: int("quantity").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InventoryStock = typeof inventoryStock.$inferSelect;
export type InsertInventoryStock = typeof inventoryStock.$inferInsert;

// ─── Inventory: Locations (Blue Boxes) ───────────────────────────────────────
export const inventoryLocations = mysqlTable("inventory_locations", {
  id: int("id").autoincrement().primaryKey(),
  locationId: varchar("location_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  city: varchar("city", { length: 128 }),
  address: text("address"),
  gateCode: varchar("gate_code", { length: 64 }),
  boxCode: varchar("box_code", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InventoryLocation = typeof inventoryLocations.$inferSelect;
export type InsertInventoryLocation = typeof inventoryLocations.$inferInsert;

// ─── Inventory: Vans ─────────────────────────────────────────────────────────
export const inventoryVans = mysqlTable("inventory_vans", {
  id: int("id").autoincrement().primaryKey(),
  vanId: varchar("van_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  locationId: varchar("location_id", { length: 64 }).notNull(),
  assignedEmployeeId: varchar("assigned_employee_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InventoryVan = typeof inventoryVans.$inferSelect;
export type InsertInventoryVan = typeof inventoryVans.$inferInsert;

// ─── Inventory: Transactions (audit log) ─────────────────────────────────────
export const inventoryTransactions = mysqlTable("inventory_transactions", {
  id: int("id").autoincrement().primaryKey(),
  txId: varchar("tx_id", { length: 64 }).notNull().unique(),
  itemId: varchar("item_id", { length: 64 }).notNull(),
  itemName: varchar("item_name", { length: 255 }),
  actionType: mysqlEnum("action_type", ["add", "remove", "adjust", "transfer_out", "transfer_in"]).notNull(),
  quantity: int("quantity").notNull(),
  locationType: mysqlEnum("location_type", ["warehouse", "location", "van"]).notNull(),
  locationId: varchar("location_id", { length: 64 }).notNull(),
  locationName: varchar("location_name", { length: 128 }),
  relatedLocationId: varchar("related_location_id", { length: 64 }),
  relatedLocationName: varchar("related_location_name", { length: 128 }),
  note: text("note"),
  performedBy: varchar("performed_by", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type InsertInventoryTransaction = typeof inventoryTransactions.$inferInsert;

// ─── Finance: Transaction Categories ─────────────────────────────────────────
export const financeCategories = mysqlTable("finance_categories", {
  id: int("id").autoincrement().primaryKey(),
  categoryId: varchar("category_id", { length: 64 }).notNull().unique(),
  type: mysqlEnum("type", ["income", "expense"]).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinanceCategory = typeof financeCategories.$inferSelect;
export type InsertFinanceCategory = typeof financeCategories.$inferInsert;

// ─── Finance: Transactions (income + expense) ─────────────────────────────────
export const financeTransactions = mysqlTable("finance_transactions", {
  id: int("id").autoincrement().primaryKey(),
  txId: varchar("tx_id", { length: 64 }).notNull().unique(),
  type: mysqlEnum("type", ["income", "expense"]).notNull(),
  categoryId: varchar("category_id", { length: 64 }).notNull(),
  categoryName: varchar("category_name", { length: 128 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  location: varchar("location", { length: 128 }).notNull(),
  cityId: varchar("city_id", { length: 64 }),
  jobId: varchar("job_id", { length: 64 }),
  van: varchar("van", { length: 128 }),
  notes: text("notes"),
  receiptUrl: varchar("receipt_url", { length: 1024 }),
  receiptUploadedAt: timestamp("receipt_uploaded_at"),
  hasReceipt: mysqlEnum("has_receipt", ["yes", "no"]).default("no").notNull(),
  performedBy: varchar("performed_by", { length: 64 }).notNull(),
  editHistory: text("edit_history"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinanceTransaction = typeof financeTransactions.$inferSelect;
export type InsertFinanceTransaction = typeof financeTransactions.$inferInsert;

// ─── Finance: Assets ──────────────────────────────────────────────────────────
export const financeAssets = mysqlTable("finance_assets", {
  id: int("id").autoincrement().primaryKey(),
  assetId: varchar("asset_id", { length: 64 }).notNull().unique(),
  assetType: mysqlEnum("asset_type", ["current", "fixed"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  value: decimal("value", { precision: 12, scale: 2 }).notNull(),
  location: varchar("location", { length: 128 }),
  dateAdded: varchar("date_added", { length: 16 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinanceAsset = typeof financeAssets.$inferSelect;
export type InsertFinanceAsset = typeof financeAssets.$inferInsert;

// ─── Finance: Liabilities ─────────────────────────────────────────────────────
export const financeLiabilities = mysqlTable("finance_liabilities", {
  id: int("id").autoincrement().primaryKey(),
  liabilityId: varchar("liability_id", { length: 64 }).notNull().unique(),
  liabilityType: mysqlEnum("liability_type", ["loan", "credit_card", "equipment_financing", "other"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  balance: decimal("balance", { precision: 12, scale: 2 }).notNull(),
  monthlyPayment: decimal("monthly_payment", { precision: 10, scale: 2 }),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }),
  dueDate: varchar("due_date", { length: 16 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinanceLiability = typeof financeLiabilities.$inferSelect;
export type InsertFinanceLiability = typeof financeLiabilities.$inferInsert;

// ─── Finance: Equity Contributions ───────────────────────────────────────────
export const financeEquity = mysqlTable("finance_equity", {
  id: int("id").autoincrement().primaryKey(),
  equityId: varchar("equity_id", { length: 64 }).notNull().unique(),
  description: varchar("description", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  notes: text("notes"),
  performedBy: varchar("performed_by", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinanceEquity = typeof financeEquity.$inferSelect;
export type InsertFinanceEquity = typeof financeEquity.$inferInsert;

// ─── Finance: Vendors ─────────────────────────────────────────────────────────
export const financeVendors = mysqlTable("finance_vendors", {
  id: int("id").autoincrement().primaryKey(),
  vendorId: varchar("vendor_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 128 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 255 }),
  loginEmail: varchar("login_email", { length: 255 }),
  loginPassword: varchar("login_password", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinanceVendor = typeof financeVendors.$inferSelect;
export type InsertFinanceVendor = typeof financeVendors.$inferInsert;

// ─── Finance: Cities ──────────────────────────────────────────────────────────
export const financeCities = mysqlTable("finance_cities", {
  id: int("id").autoincrement().primaryKey(),
  cityId: varchar("city_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),  // e.g. "destin", "crestview"
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinanceCity = typeof financeCities.$inferSelect;
export type InsertFinanceCity = typeof financeCities.$inferInsert;

// ─── Finance: Bank Statements ─────────────────────────────────────────────────
export const bankStatements = mysqlTable("bank_statements", {
  id: int("id").autoincrement().primaryKey(),
  statementId: varchar("statement_id", { length: 64 }).notNull().unique(),
  cityId: varchar("city_id", { length: 64 }),
  bankName: varchar("bank_name", { length: 128 }),
  accountLast4: varchar("account_last4", { length: 4 }),
  statementDate: varchar("statement_date", { length: 16 }),  // YYYY-MM-DD
  periodFrom: varchar("period_from", { length: 16 }),
  periodTo: varchar("period_to", { length: 16 }),
  fileUrl: varchar("file_url", { length: 1024 }),
  fileName: varchar("file_name", { length: 255 }),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  txCount: int("tx_count").default(0).notNull(),
  importedCount: int("imported_count").default(0).notNull(),
  errorMsg: text("error_msg"),
  uploadedBy: varchar("uploaded_by", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type BankStatement = typeof bankStatements.$inferSelect;
export type InsertBankStatement = typeof bankStatements.$inferInsert;

// ─── Finance: Bank Transactions ───────────────────────────────────────────────
export const bankTransactions = mysqlTable("bank_transactions", {
  id: int("id").autoincrement().primaryKey(),
  bankTxId: varchar("bank_tx_id", { length: 64 }).notNull().unique(),
  statementId: varchar("statement_id", { length: 64 }).notNull(),
  date: varchar("date", { length: 16 }).notNull(),           // YYYY-MM-DD
  description: varchar("description", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type: mysqlEnum("type", ["debit", "credit"]).notNull(),    // debit=expense, credit=income
  category: varchar("category", { length: 128 }),
  balance: decimal("balance", { precision: 12, scale: 2 }),
  // Reconciliation
  status: mysqlEnum("status", ["unmatched", "matched", "ignored"]).default("unmatched").notNull(),
  matchedTxId: varchar("matched_tx_id", { length: 64 }),     // finance_transactions.tx_id
  financeEntryCreated: tinyint("finance_entry_created").default(0).notNull(),
  financeEntryTxId: varchar("finance_entry_tx_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type InsertBankTransaction = typeof bankTransactions.$inferInsert;

// ─── Customer Portal Tables ───

export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  customerId: varchar("customer_id", { length: 64 }).notNull().unique(),
  firstName: varchar("first_name", { length: 128 }).notNull(),
  lastName: varchar("last_name", { length: 128 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  phone: varchar("phone", { length: 32 }),
  city: varchar("city", { length: 128 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  pushToken: text("push_token"),
  profilePhotoUrl: text("profile_photo_url"),
  doNotService: tinyint("do_not_service").default(0).notNull(),
  doNotServiceReason: text("do_not_service_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

export const customerVehicles = mysqlTable("customer_vehicles", {
  id: int("id").autoincrement().primaryKey(),
  vehicleId: varchar("vehicle_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  year: varchar("year", { length: 8 }).notNull(),
  make: varchar("make", { length: 64 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  vehicleType: mysqlEnum("vehicle_type", ["sedan", "suv", "large_suv_van", "truck", "rv"]).notNull(),
  color: varchar("color", { length: 64 }),
  rvClass: varchar("rv_class", { length: 64 }),  // Class A, Class B, Class C, Fifth Wheel, Bumper Pull Trailer
  rvLengthFt: int("rv_length_ft"),               // Length in feet for pricing tier
  isDefault: tinyint("is_default").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CustomerVehicle = typeof customerVehicles.$inferSelect;
export type InsertCustomerVehicle = typeof customerVehicles.$inferInsert;

export const customerAddresses = mysqlTable("customer_addresses", {
  id: int("id").autoincrement().primaryKey(),
  addressId: varchar("address_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  label: varchar("label", { length: 64 }).notNull().default("Home"),
  street: varchar("street", { length: 255 }).notNull(),
  unit: varchar("unit", { length: 64 }),
  city: varchar("city", { length: 128 }).notNull(),
  state: varchar("state", { length: 64 }).notNull(),
  zip: varchar("zip", { length: 16 }).notNull(),
  isDefault: tinyint("is_default").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type InsertCustomerAddress = typeof customerAddresses.$inferInsert;

// Address location photos — up to 2 photos per address key (normalized address string)
export const addressPhotos = mysqlTable("address_photos", {
  id: int("id").autoincrement().primaryKey(),
  photoId: varchar("photo_id", { length: 64 }).notNull().unique(),
  addressKey: varchar("address_key", { length: 512 }).notNull(),
  photoUrl: text("photo_url").notNull(),
  caption: varchar("caption", { length: 255 }),
  uploadedBy: varchar("uploaded_by", { length: 64 }),
  uploadedByRole: varchar("uploaded_by_role", { length: 32 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AddressPhoto = typeof addressPhotos.$inferSelect;
export type InsertAddressPhoto = typeof addressPhotos.$inferInsert;

export const customerBookings = mysqlTable("customer_bookings", {
  id: int("id").autoincrement().primaryKey(),
  bookingRef: varchar("booking_ref", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  vehicleId: varchar("vehicle_id", { length: 64 }).notNull(),
  vehicleType: mysqlEnum("vehicle_type", ["sedan", "suv", "large_suv_van", "truck", "rv"]).notNull(),
  vehicleLabel: varchar("vehicle_label", { length: 255 }),
  packageId: varchar("package_id", { length: 64 }).notNull(),
  packageName: varchar("package_name", { length: 128 }).notNull(),
  addons: text("addons"),   // JSON array of addon ids
  addressId: varchar("address_id", { length: 64 }),
  addressLabel: varchar("address_label", { length: 512 }),
  city: varchar("city", { length: 128 }),
  scheduledDate: varchar("scheduled_date", { length: 16 }).notNull(),
  scheduledTime: varchar("scheduled_time", { length: 32 }).notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  discountCode: varchar("discount_code", { length: 64 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }).default("0"),
  depositPaymentIntentId: varchar("deposit_payment_intent_id", { length: 128 }),
  status: mysqlEnum("status", ["pending", "confirmed", "en_route", "arrived", "in_progress", "completed", "cancelled"]).default("pending").notNull(),
  assignedEmployeeId: varchar("assigned_employee_id", { length: 64 }),
  notes: text("notes"),
  // Payment record — populated when admin/detailer collects payment
  paymentMethod: varchar("payment_method", { length: 32 }),        // "credit_debit" | "cash" | "check" | "other"
  paymentIntentId: varchar("payment_intent_id", { length: 128 }),  // Stripe PaymentIntent ID (if card)
  paymentTotal: decimal("payment_total", { precision: 10, scale: 2 }),
  paymentPaidAt: varchar("payment_paid_at", { length: 64 }),       // ISO timestamp string
  lateEta: varchar("late_eta", { length: 32 }),                    // Updated ETA when detailer is running late (e.g. "3:30 PM")
  lateNotifiedAt: varchar("late_notified_at", { length: 64 }),     // ISO timestamp when late notification was sent
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CustomerBooking = typeof customerBookings.$inferSelect;
export type InsertCustomerBooking = typeof customerBookings.$inferInsert;

export const customerSessions = mysqlTable("customer_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CustomerSession = typeof customerSessions.$inferSelect;
export type InsertCustomerSession = typeof customerSessions.$inferInsert;

// ─── Equipment Repair: Equipment List (admin-managed) ─────────────────────────
export const repairEquipment = mysqlTable("repair_equipment", {
  id: int("id").autoincrement().primaryKey(),
  equipmentId: varchar("equipment_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }),
  // JSON array of sub-issue strings, e.g. ["Hose broken","Not sucking","Not spraying water"]
  subIssues: text("sub_issues"),
  isActive: tinyint("is_active").default(1).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RepairEquipment = typeof repairEquipment.$inferSelect;
export type InsertRepairEquipment = typeof repairEquipment.$inferInsert;

// ─── Equipment Repair: Repair Orders ─────────────────────────────────────────
export const repairOrders = mysqlTable("repair_orders", {
  id: int("id").autoincrement().primaryKey(),
  repairId: varchar("repair_id", { length: 64 }).notNull().unique(),
  vanId: varchar("van_id", { length: 64 }).notNull(),
  vanName: varchar("van_name", { length: 128 }),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  employeeName: varchar("employee_name", { length: 255 }),
  equipmentId: varchar("equipment_id", { length: 64 }).notNull(),
  equipmentName: varchar("equipment_name", { length: 128 }).notNull(),
  subIssue: varchar("sub_issue", { length: 255 }),
  notes: text("notes"),
  status: mysqlEnum("status", ["open", "in_progress", "resolved"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type RepairOrder = typeof repairOrders.$inferSelect;
export type InsertRepairOrder = typeof repairOrders.$inferInsert;

// ─── Employee Van Assignment ───────────────────────────────────────────────────
export const employeeVanAssignments = mysqlTable("employee_van_assignments", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull().unique(),
  vanId: varchar("van_id", { length: 64 }).notNull(),
  vanName: varchar("van_name", { length: 128 }),
  /** shift1 = Mon–Thu (first shift); shift2 = Fri–Sun (second shift / assistant) */
  shift: varchar("shift", { length: 16 }).default("shift1"),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  assignedBy: varchar("assigned_by", { length: 255 }),
});
export type EmployeeVanAssignment = typeof employeeVanAssignments.$inferSelect;
export type InsertEmployeeVanAssignment = typeof employeeVanAssignments.$inferInsert;

// ─── Investor Portal ──────────────────────────────────────────────────────────
export const investors = mysqlTable("investors", {
  id: int("id").autoincrement().primaryKey(),
  investorId: varchar("investor_id", { length: 64 }).notNull().unique(),
  firstName: varchar("first_name", { length: 128 }).notNull(),
  lastName: varchar("last_name", { length: 128 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  phone: varchar("phone", { length: 32 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  accountStatus: mysqlEnum("account_status", ["active", "pending", "suspended", "closed"]).default("active").notNull(),
  role: varchar("role", { length: 32 }).default("investor").notNull(),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Investor = typeof investors.$inferSelect;
export type InsertInvestor = typeof investors.$inferInsert;

export const investorSessions = mysqlTable("investor_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  investorId: varchar("investor_id", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InvestorSession = typeof investorSessions.$inferSelect;

export const investments = mysqlTable("investments", {
  id: int("id").autoincrement().primaryKey(),
  investmentId: varchar("investment_id", { length: 64 }).notNull().unique(),
  investorId: varchar("investor_id", { length: 64 }).notNull(),
  investmentAmount: decimal("investment_amount", { precision: 12, scale: 2 }).notNull(),
  investmentDate: varchar("investment_date", { length: 16 }).notNull(),
  loanTermMonths: int("loan_term_months"),
  repaymentType: varchar("repayment_type", { length: 64 }).default("monthly"),
  agreedReturnAmount: decimal("agreed_return_amount", { precision: 12, scale: 2 }),
  totalRepaymentAmount: decimal("total_repayment_amount", { precision: 12, scale: 2 }),
  totalPaymentsExpected: int("total_payments_expected"),
  status: mysqlEnum("status", ["pending_funding", "active", "repayment_in_progress", "paid_in_full", "delayed", "document_pending", "closed"]).default("pending_funding").notNull(),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Investment = typeof investments.$inferSelect;
export type InsertInvestment = typeof investments.$inferInsert;

export const investmentPayments = mysqlTable("investment_payments", {
  id: int("id").autoincrement().primaryKey(),
  paymentId: varchar("payment_id", { length: 64 }).notNull().unique(),
  investmentId: varchar("investment_id", { length: 64 }).notNull(),
  dueDate: varchar("due_date", { length: 16 }),
  paidDate: varchar("paid_date", { length: 16 }),
  amountDue: decimal("amount_due", { precision: 12, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }),
  status: mysqlEnum("status", ["scheduled", "pending", "completed", "missed", "delayed"]).default("scheduled").notNull(),
  paymentMethod: varchar("payment_method", { length: 64 }),
  referenceNumber: varchar("reference_number", { length: 128 }),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InvestmentPayment = typeof investmentPayments.$inferSelect;
export type InsertInvestmentPayment = typeof investmentPayments.$inferInsert;

export const investorDocuments = mysqlTable("investor_documents", {
  id: int("id").autoincrement().primaryKey(),
  documentId: varchar("document_id", { length: 64 }).notNull().unique(),
  investorId: varchar("investor_id", { length: 64 }).notNull(),
  investmentId: varchar("investment_id", { length: 64 }),
  documentTitle: varchar("document_title", { length: 255 }).notNull(),
  documentType: mysqlEnum("document_type", ["agreement", "promissory_note", "receipt", "statement", "tax_document", "company_update", "other"]).default("other").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  fileUrl: varchar("file_url", { length: 1024 }),
  uploadedBy: varchar("uploaded_by", { length: 255 }),
  visibilityStatus: mysqlEnum("visibility_status", ["visible", "hidden"]).default("visible").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});
export type InvestorDocument = typeof investorDocuments.$inferSelect;
export type InsertInvestorDocument = typeof investorDocuments.$inferInsert;

export const investorUpdates = mysqlTable("investor_updates", {
  id: int("id").autoincrement().primaryKey(),
  updateId: varchar("update_id", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  category: mysqlEnum("category", ["business_progress", "fleet_expansion", "revenue_milestone", "repayment_update", "important_notice", "general"]).default("general").notNull(),
  visibility: mysqlEnum("visibility", ["all_investors", "specific"]).default("all_investors").notNull(),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InvestorUpdate = typeof investorUpdates.$inferSelect;
export type InsertInvestorUpdate = typeof investorUpdates.$inferInsert;

export const investorSupportRequests = mysqlTable("investor_support_requests", {
  id: int("id").autoincrement().primaryKey(),
  requestId: varchar("request_id", { length: 64 }).notNull().unique(),
  investorId: varchar("investor_id", { length: 64 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  messageBody: text("message_body").notNull(),
  status: mysqlEnum("status", ["open", "in_review", "resolved"]).default("open").notNull(),
  adminResponse: text("admin_response"),
  respondedBy: varchar("responded_by", { length: 255 }),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InvestorSupportRequest = typeof investorSupportRequests.$inferSelect;
export type InsertInvestorSupportRequest = typeof investorSupportRequests.$inferInsert;

export const investorAuditLog = mysqlTable("investor_audit_log", {
  id: int("id").autoincrement().primaryKey(),
  actorId: varchar("actor_id", { length: 255 }).notNull(),
  actorName: varchar("actor_name", { length: 255 }),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  recordType: varchar("record_type", { length: 64 }).notNull(),
  recordId: varchar("record_id", { length: 64 }),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type InvestorAuditLog = typeof investorAuditLog.$inferSelect;

// ─── Investor Inquiries (Lead Capture) ───────────────────────────────────────
export const investorInquiries = mysqlTable("investor_inquiries", {
  id: int("id").autoincrement().primaryKey(),
  inquiryId: varchar("inquiry_id", { length: 64 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  investmentInterest: varchar("investment_interest", { length: 64 }),
  message: text("message"),
  status: mysqlEnum("status", ["new", "contacted", "qualified", "closed"]).default("new").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InvestorInquiry = typeof investorInquiries.$inferSelect;
export type InsertInvestorInquiry = typeof investorInquiries.$inferInsert;

// ─── AI Receptionist Knowledge Base ──────────────────────────────────────────
export const aiKnowledgeEntries = mysqlTable("ai_knowledge_entries", {
  id: int("id").autoincrement().primaryKey(),
  entryId: varchar("entry_id", { length: 64 }).notNull().unique(),
  category: varchar("category", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  isActive: tinyint("is_active").default(1).notNull(),
  orderIndex: int("order_index").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type AiKnowledgeEntry = typeof aiKnowledgeEntries.$inferSelect;
export type InsertAiKnowledgeEntry = typeof aiKnowledgeEntries.$inferInsert;

// ─── Customer Payment Methods (saved cards) ───────────────────────────────────
export const customerPaymentMethods = mysqlTable("customer_payment_methods", {
  id: int("id").autoincrement().primaryKey(),
  methodId: varchar("method_id", { length: 64 }).notNull().unique(),
  customerKey: varchar("customer_key", { length: 255 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 32 }),
  customerEmail: varchar("customer_email", { length: 320 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).notNull(),
  stripePaymentMethodId: varchar("stripe_payment_method_id", { length: 64 }).notNull(),
  cardBrand: varchar("card_brand", { length: 32 }),
  cardLast4: varchar("card_last4", { length: 4 }),
  cardExpMonth: int("card_exp_month"),
  cardExpYear: int("card_exp_year"),
  isDefault: tinyint("is_default").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type CustomerPaymentMethod = typeof customerPaymentMethods.$inferSelect;
export type InsertCustomerPaymentMethod = typeof customerPaymentMethods.$inferInsert;

// ─── Do Not Service List ───
export const doNotServiceList = mysqlTable("do_not_service_list", {
  id: int("id").autoincrement().primaryKey(),
  customerKey: varchar("customer_key", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  reason: text("reason"),
  addedBy: varchar("added_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DoNotServiceEntry = typeof doNotServiceList.$inferSelect;
export type InsertDoNotServiceEntry = typeof doNotServiceList.$inferInsert;

// ─── Phone System ───
export const phoneLines = mysqlTable("phone_lines", {
  id: int("id").autoincrement().primaryKey(),
  lineName: varchar("line_name", { length: 100 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull().unique(),
  twilioSid: varchar("twilio_sid", { length: 100 }),
  color: varchar("color", { length: 20 }).default("#0a7ea4"),
  aiReceptionistEnabled: tinyint("ai_receptionist_enabled").default(0),
  forwardToEmployees: tinyint("forward_to_employees").default(1),
  isActive: tinyint("is_active").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PhoneLine = typeof phoneLines.$inferSelect;
export type InsertPhoneLine = typeof phoneLines.$inferInsert;

export const smsMessages = mysqlTable("sms_messages", {
  id: int("id").autoincrement().primaryKey(),
  lineId: int("line_id").notNull(),
  twilioMessageSid: varchar("twilio_message_sid", { length: 100 }),
  direction: varchar("direction", { length: 10 }).notNull(),
  fromNumber: varchar("from_number", { length: 20 }).notNull(),
  toNumber: varchar("to_number", { length: 20 }).notNull(),
  body: text("body"),
  mediaUrl: text("media_url"),
  status: varchar("status", { length: 30 }).default("received"),
  sentByEmployeeId: varchar("sent_by_employee_id", { length: 50 }),
  isRead: tinyint("is_read").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SmsMessage = typeof smsMessages.$inferSelect;
export type InsertSmsMessage = typeof smsMessages.$inferInsert;

export const callLogs = mysqlTable("call_logs", {
  id: int("id").autoincrement().primaryKey(),
  lineId: int("line_id"),
  twilioCallSid: varchar("twilio_call_sid", { length: 100 }),
  direction: varchar("direction", { length: 10 }).notNull(),
  fromNumber: varchar("from_number", { length: 20 }).notNull(),
  toNumber: varchar("to_number", { length: 20 }).notNull(),
  status: varchar("status", { length: 30 }),
  durationSeconds: int("duration_seconds").default(0),
  answeredByEmployeeId: varchar("answered_by_employee_id", { length: 50 }),
  recordingUrl: text("recording_url"),
  aiHandled: tinyint("ai_handled").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CallLog = typeof callLogs.$inferSelect;
export type InsertCallLog = typeof callLogs.$inferInsert;

// ─── Detailer Points table (accountability system) ───
// Tracks the current point balance for each detailer for the current week.
// Resets to 10 every Monday. Falls below 7 = bonus ineligible.
export const detailerPoints = mysqlTable("detailer_points", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull().unique(),
  currentPoints: decimal("current_points", { precision: 5, scale: 1 }).notNull().default("10.0"),
  weekStartDate: varchar("week_start_date", { length: 16 }).notNull(), // YYYY-MM-DD of the Monday
  bonusEligible: tinyint("bonus_eligible").notNull().default(1), // 1 = eligible, 0 = not
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type DetailerPoints = typeof detailerPoints.$inferSelect;
export type InsertDetailerPoints = typeof detailerPoints.$inferInsert;

// ─── Point Violations table ───
// Log of every point deduction issued by admin/ops manager.
export const pointViolations = mysqlTable("point_violations", {
  id: int("id").autoincrement().primaryKey(),
  violationId: varchar("violation_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  employeeName: varchar("employee_name", { length: 255 }),
  violationType: mysqlEnum("violation_type", [
    "missed_morning_meeting",
    "no_before_after_photos",
    "no_late_arrival_notice",
    "vehicle_damage",
    "qc_issue",
    "forgot_clock_in_out",
    "other",
  ]).notNull(),
  pointsDeducted: decimal("points_deducted", { precision: 4, scale: 1 }).notNull(),
  notes: text("notes"),
  weekStartDate: varchar("week_start_date", { length: 16 }).notNull(),
  issuedBy: varchar("issued_by", { length: 255 }).notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  writeUpNotifId: varchar("write_up_notif_id", { length: 64 }),
});
export type PointViolation = typeof pointViolations.$inferSelect;
export type InsertPointViolation = typeof pointViolations.$inferInsert;

// ─── Late Arrival History table ────────────────────────────────────────────────
// One row per "Running Late" notification sent by a detailer for a job.
export const lateArrivalHistory = mysqlTable("late_arrival_history", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  detailerName: varchar("detailer_name", { length: 255 }),
  customerName: varchar("customer_name", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 32 }),
  delayMinutes: int("delay_minutes").notNull(),
  newEta: varchar("new_eta", { length: 32 }),
  smsBody: text("sms_body"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});
export type LateArrivalHistory = typeof lateArrivalHistory.$inferSelect;
export type InsertLateArrivalHistory = typeof lateArrivalHistory.$inferInsert;

// ─── Training Quiz Questions table ─────────────────────────────────────────────
// Per-module multiple choice questions (admin customizable)
export const trainingQuizQuestions = mysqlTable("training_quiz_questions", {
  id: int("id").autoincrement().primaryKey(),
  questionId: varchar("question_id", { length: 64 }).notNull().unique(),
  moduleId: varchar("module_id", { length: 64 }).notNull(),
  questionText: text("question_text").notNull(),
  optionA: varchar("option_a", { length: 512 }).notNull(),
  optionB: varchar("option_b", { length: 512 }).notNull(),
  optionC: varchar("option_c", { length: 512 }).notNull(),
  optionD: varchar("option_d", { length: 512 }).notNull(),
  correctAnswer: mysqlEnum("correct_answer_tq", ["A", "B", "C", "D"]).notNull(),
  orderIndex: int("order_index_tq").notNull().default(0),
  createdAt: timestamp("created_at_tq").defaultNow().notNull(),
});
export type TrainingQuizQuestion = typeof trainingQuizQuestions.$inferSelect;
export type InsertTrainingQuizQuestion = typeof trainingQuizQuestions.$inferInsert;

// ─── Training Quiz Attempts table ──────────────────────────────────────────────
// Per-employee quiz attempt records with score and answers
export const trainingQuizAttempts = mysqlTable("training_quiz_attempts", {
  id: int("id").autoincrement().primaryKey(),
  attemptId: varchar("attempt_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  moduleId: varchar("module_id", { length: 64 }).notNull(),
  score: int("score").notNull(),
  totalQuestions: int("total_questions").notNull(),
  answers: text("answers"),
  passed: mysqlEnum("passed_tqa", ["yes", "no"]).notNull().default("no"),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});
export type TrainingQuizAttempt = typeof trainingQuizAttempts.$inferSelect;
export type InsertTrainingQuizAttempt = typeof trainingQuizAttempts.$inferInsert;

// ─── Geofence Zones table ──────────────────────────────────────────────────────
export const geofenceZones = mysqlTable("geofence_zones", {
  id: int("id").autoincrement().primaryKey(),
  zoneId: varchar("zone_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 512 }).notNull(),
  latitude: double("latitude").notNull(),
  longitude: double("longitude").notNull(),
  radiusMeters: int("radius_meters").notNull().default(402),
  isActive: tinyint("is_active").notNull().default(1),
  createdBy: varchar("created_by", { length: 64 }),
  createdAt: timestamp("created_at_gz").defaultNow().notNull(),
});
export type GeofenceZone = typeof geofenceZones.$inferSelect;
export type InsertGeofenceZone = typeof geofenceZones.$inferInsert;

// ─── Geofence Events table ─────────────────────────────────────────────────────
export const geofenceEvents = mysqlTable("geofence_events", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("event_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  zoneId: varchar("zone_id", { length: 64 }).notNull(),
  zoneName: varchar("zone_name", { length: 255 }),
  eventType: mysqlEnum("event_type", ["enter", "exit"]).notNull(),
  latitude: double("latitude_gfe"),
  longitude: double("longitude_gfe"),
  createdAt: timestamp("created_at_gfe").defaultNow().notNull(),
});
export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type InsertGeofenceEvent = typeof geofenceEvents.$inferInsert;

// ─── EOD Checklists table ──────────────────────────────────────────────────────
export const eodChecklists = mysqlTable("eod_checklists", {
  id: int("id").autoincrement().primaryKey(),
  checklistId: varchar("checklist_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }),
  date: varchar("date", { length: 16 }).notNull(),
  status: mysqlEnum("status_eod", ["pending", "submitted", "approved", "violated"]).notNull().default("pending"),
  submittedAt: datetime("submitted_at"),
  reviewedBy: varchar("reviewed_by", { length: 64 }),
  reviewedAt: datetime("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at_eod").defaultNow().notNull(),
});
export type EodChecklist = typeof eodChecklists.$inferSelect;
export type InsertEodChecklist = typeof eodChecklists.$inferInsert;

// ─── EOD Checklist Items table ─────────────────────────────────────────────────
export const eodChecklistItems = mysqlTable("eod_checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  itemId: varchar("item_id", { length: 64 }).notNull().unique(),
  checklistId: varchar("checklist_id", { length: 64 }).notNull(),
  stepKey: mysqlEnum("step_key", ["back_photo", "driver_side_photo", "passenger_side_photo", "driver_area", "box_photo", "chemicals_stocked", "towels_stocked"]).notNull(),
  photoUrl: text("photo_url"),
  completedAt: datetime("completed_at"),
});
export type EodChecklistItem = typeof eodChecklistItems.$inferSelect;
export type InsertEodChecklistItem = typeof eodChecklistItems.$inferInsert;

// ─── Email Logs ───────────────────────────────────────────────────────────────
export const emailLogs = mysqlTable("email_logs", {
  id: int("id").autoincrement().primaryKey(),
  logId: varchar("log_id", { length: 64 }).notNull().unique(),
  to: varchar("to", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  type: mysqlEnum("type", ["booking_confirmation", "notification", "other", "review_request"]).notNull().default("other"),
  customerName: varchar("customer_name", { length: 255 }),
  bookingRef: varchar("booking_ref", { length: 64 }),
  status: mysqlEnum("status", ["sent", "failed"]).notNull().default("sent"),
  body: text("body"),
  sentAt: datetime("sent_at").notNull(),
});
export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = typeof emailLogs.$inferInsert;

// ─── Site Inspections table ────────────────────────────────────────────────────
export const siteInspections = mysqlTable("site_inspections", {
  id: int("id").autoincrement().primaryKey(),
  inspectionId: varchar("inspection_id", { length: 64 }).notNull().unique(),
  opsManagerId: varchar("ops_manager_id", { length: 64 }).notNull(),
  opsManagerName: varchar("ops_manager_name", { length: 255 }),
  detailerId: varchar("detailer_id", { length: 64 }).notNull(),
  detailerName: varchar("detailer_name", { length: 255 }),
  bookingId: varchar("booking_id", { length: 64 }),
  jobAddress: varchar("job_address", { length: 500 }),
  inspectedAt: datetime("inspected_at").notNull(),
  overallPass: tinyint("overall_pass").notNull().default(1),
  notes: text("notes_si"),
  createdAt: timestamp("created_at_si").defaultNow().notNull(),
});
export type SiteInspection = typeof siteInspections.$inferSelect;
export type InsertSiteInspection = typeof siteInspections.$inferInsert;

// ─── Site Inspection Items table ───────────────────────────────────────────────
export const siteInspectionItems = mysqlTable("site_inspection_items", {
  id: int("id").autoincrement().primaryKey(),
  itemId: varchar("item_id_si", { length: 64 }).notNull().unique(),
  inspectionId: varchar("inspection_id_ref", { length: 64 }).notNull(),
  checkKey: varchar("check_key", { length: 64 }).notNull(),
  checkLabel: varchar("check_label", { length: 255 }).notNull(),
  passed: tinyint("passed").notNull().default(1),
  notes: text("notes_sii"),
});
export type SiteInspectionItem = typeof siteInspectionItems.$inferSelect;
export type InsertSiteInspectionItem = typeof siteInspectionItems.$inferInsert;

// ─── Van Checklist Submissions table ──────────────────────────────────────────
export const vanChecklists = mysqlTable("van_checklists", {
  id: int("id").autoincrement().primaryKey(),
  checklistId: varchar("checklist_id_vc", { length: 64 }).notNull().unique(),
  opsManagerId: varchar("ops_manager_id_vc", { length: 64 }).notNull(),
  opsManagerName: varchar("ops_manager_name_vc", { length: 255 }),
  detailerId: varchar("detailer_id_vc", { length: 64 }).notNull(),
  detailerName: varchar("detailer_name_vc", { length: 255 }),
  submittedAt: datetime("submitted_at_vc").notNull(),
  allItemsPresent: tinyint("all_items_present").notNull().default(1),
  notes: text("notes_vc"),
  createdAt: timestamp("created_at_vc").defaultNow().notNull(),
});
export type VanChecklist = typeof vanChecklists.$inferSelect;
export type InsertVanChecklist = typeof vanChecklists.$inferInsert;

// ─── Van Checklist Items table ─────────────────────────────────────────────────
export const vanChecklistItems = mysqlTable("van_checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  itemId: varchar("item_id_vci", { length: 64 }).notNull().unique(),
  checklistId: varchar("checklist_id_vci", { length: 64 }).notNull(),
  category: varchar("category_vci", { length: 64 }).notNull(),
  itemName: varchar("item_name_vci", { length: 255 }).notNull(),
  present: tinyint("present").notNull().default(1),
});
export type VanChecklistItem = typeof vanChecklistItems.$inferSelect;
export type InsertVanChecklistItem = typeof vanChecklistItems.$inferInsert;

// ─── Van Checklist Custom Items (admin-managed master list additions/removals) ─
export const vanChecklistCustomItems = mysqlTable("van_checklist_custom_items", {
  id: int("id").autoincrement().primaryKey(),
  category: varchar("category_vcci", { length: 64 }).notNull(),
  itemName: varchar("item_name_vcci", { length: 255 }).notNull(),
  action: varchar("action_vcci", { length: 8 }).notNull().default("add"), // 'add' | 'remove'
  createdAt: timestamp("created_at_vcci").defaultNow().notNull(),
});
export type VanChecklistCustomItem = typeof vanChecklistCustomItems.$inferSelect;
export type InsertVanChecklistCustomItem = typeof vanChecklistCustomItems.$inferInsert;

// ─── Service Locations (Cities) ───────────────────────────────────────────────
export const serviceLocations = mysqlTable("service_locations", {
  id: int("id").autoincrement().primaryKey(),
  locationId: varchar("location_id_sl", { length: 64 }).notNull().unique(),
  name: varchar("name_sl", { length: 128 }).notNull(),
  slug: varchar("slug_sl", { length: 64 }).notNull().unique(),
  state: varchar("state_sl", { length: 4 }).default("FL").notNull(),
  isActive: tinyint("is_active_sl").default(1).notNull(),
  sortOrder: int("sort_order_sl").default(0).notNull(),
  zapierWebhookUrl: varchar("zapier_webhook_url_sl", { length: 512 }),
  thankYouPageUrl: varchar("thank_you_page_url_sl", { length: 512 }),
  bookingUrl: varchar("booking_url_sl", { length: 512 }),
  availableDays: text("available_days_sl"),
  startHour: int("start_hour_sl").default(8),
  endHour: int("end_hour_sl").default(18),
  slotDurationMinutes: int("slot_duration_sl").default(60),
  latitude: varchar("latitude_sl", { length: 32 }),
  longitude: varchar("longitude_sl", { length: 32 }),
  radiusMeters: int("radius_meters_sl").default(40000),
  notes: text("notes_sl"),
  createdAt: timestamp("created_at_sl").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_sl").defaultNow().onUpdateNow().notNull(),
});
export type ServiceLocation = typeof serviceLocations.$inferSelect;
export type InsertServiceLocation = typeof serviceLocations.$inferInsert;

// ─── Service Location Detailers (many-to-many) ────────────────────────────────
export const serviceLocationDetailers = mysqlTable("service_location_detailers", {
  id: int("id").autoincrement().primaryKey(),
  locationId: varchar("location_id_sld", { length: 64 }).notNull(),
  employeeId: varchar("employee_id_sld", { length: 64 }).notNull(),
  isPrimary: tinyint("is_primary_sld").default(0).notNull(),
  createdAt: timestamp("created_at_sld").defaultNow().notNull(),
});
export type ServiceLocationDetailer = typeof serviceLocationDetailers.$inferSelect;
export type InsertServiceLocationDetailer = typeof serviceLocationDetailers.$inferInsert;

// ─── Promotions / Discount Banners ────────────────────────────────────────────
export const promotions = mysqlTable("promotions", {
  id: int("id").autoincrement().primaryKey(),
  promoId: varchar("promo_id", { length: 64 }).notNull().unique(),
  title: varchar("title_promo", { length: 128 }).notNull(),
  description: text("description_promo"),
  discountType: mysqlEnum("discount_type_promo", ["percent", "fixed", "none"]).default("none").notNull(),
  discountValue: decimal("discount_value_promo", { precision: 10, scale: 2 }).default("0"),
  promoCode: varchar("promo_code_promo", { length: 64 }),
  bgColor: varchar("bg_color_promo", { length: 32 }).default("#0057FF").notNull(),
  emoji: varchar("emoji_promo", { length: 16 }).default("🎉").notNull(),
  startDate: varchar("start_date_promo", { length: 16 }),
  endDate: varchar("end_date_promo", { length: 16 }),
  isActive: tinyint("is_active_promo").default(1).notNull(),
  createdBy: varchar("created_by_promo", { length: 64 }),
  createdAt: timestamp("created_at_promo").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_promo").defaultNow().onUpdateNow().notNull(),
});
export type Promotion = typeof promotions.$inferSelect;
export type InsertPromotion = typeof promotions.$inferInsert;

// ─── Interactive Training Step Overrides ──────────────────────────────────────
// Stores admin-edited content for the hardcoded interactive training modules.
// Key = "moduleId:stepIndex" (e.g. "door-jambs:0"). Falls back to hardcoded defaults when absent.
export const interactiveStepOverrides = mysqlTable("interactive_step_overrides", {
  id: int("id").autoincrement().primaryKey(),
  overrideKey: varchar("override_key", { length: 128 }).notNull().unique(), // "moduleId:stepIndex"
  moduleId: varchar("module_id_iso", { length: 64 }).notNull(),
  stepIndex: int("step_index_iso").notNull(),
  title: varchar("title_iso", { length: 512 }),
  instruction: text("instruction_iso"),
  area: varchar("area_iso", { length: 128 }),
  question: text("question_iso"),
  proTip: text("pro_tip_iso"),
  choiceLabels: text("choice_labels_iso"),
  vehicleImageUrl: text("vehicle_image_url_iso"),
  videoUrl: text("video_url_iso"),
  isDeleted: boolean("is_deleted_iso").default(false).notNull(),
  createdAt: timestamp("created_at_iso").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_iso").defaultNow().onUpdateNow().notNull(),
});
export type InteractiveStepOverride = typeof interactiveStepOverrides.$inferSelect;
export type InsertInteractiveStepOverride = typeof interactiveStepOverrides.$inferInsert;

// ─── Company Meetings ─────────────────────────────────────────────────────────
// Scheduled company-wide Zoom meetings visible to all team members.
export const companyMeetings = mysqlTable("company_meetings", {
  id: int("id").autoincrement().primaryKey(),
  meetingId: varchar("meeting_id", { length: 64 }).notNull().unique(),
  title: varchar("title_cm", { length: 255 }).notNull(),
  description: text("description_cm"),
  meetingDate: varchar("meeting_date", { length: 16 }).notNull(), // YYYY-MM-DD
  meetingTime: varchar("meeting_time_cm", { length: 8 }).notNull(), // HH:MM (CST)
  zoomLink: text("zoom_link_cm"),
  isRecurring: mysqlEnum("is_recurring", ["yes", "no"]).default("no").notNull(),
  recurringDay: varchar("recurring_day", { length: 16 }), // e.g. "Monday"
  status: mysqlEnum("status_cm", ["upcoming", "cancelled", "completed"]).default("upcoming").notNull(),
  createdBy: varchar("created_by_cm", { length: 64 }),
  createdAt: timestamp("created_at_cm").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_cm").defaultNow().onUpdateNow().notNull(),
});
export type CompanyMeeting = typeof companyMeetings.$inferSelect;
export type InsertCompanyMeeting = typeof companyMeetings.$inferInsert;

// ─── Referral Program ─────────────────────────────────────────────────────────
// referral_codes: one unique code per customer used in their shareable link
export const referralCodes = mysqlTable("referral_codes", {
  id: int("id").autoincrement().primaryKey(),
  customerId: varchar("customer_id_ref", { length: 64 }).notNull().unique(),
  code: varchar("code_ref", { length: 32 }).notNull().unique(),
  createdAt: timestamp("created_at_ref").defaultNow().notNull(),
});
export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferralCode = typeof referralCodes.$inferInsert;

// referrals: tracks each referral event
export const referrals = mysqlTable("referrals", {
  id: int("id").autoincrement().primaryKey(),
  referralId: varchar("referral_id", { length: 64 }).notNull().unique(),
  referrerId: varchar("referrer_id", { length: 64 }).notNull(),
  friendId: varchar("friend_id", { length: 64 }),
  friendEmail: varchar("friend_email", { length: 255 }),
  status: mysqlEnum("status_referral", ["pending", "booked", "completed", "rewarded"]).default("pending").notNull(),
  bookingId: varchar("booking_id_ref", { length: 64 }),
  pointsAwarded: int("points_awarded").default(0).notNull(),
  createdAt: timestamp("created_at_referral").defaultNow().notNull(),
  completedAt: timestamp("completed_at_referral"),
});
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;

// points_ledger: immutable log of every point earn/spend event
export const pointsLedger = mysqlTable("points_ledger", {
  id: int("id").autoincrement().primaryKey(),
  ledgerId: varchar("ledger_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id_ledger", { length: 64 }).notNull(),
  type: mysqlEnum("type_ledger", ["earn", "redeem", "expire"]).notNull(),
  points: int("points_ledger_val").notNull(),
  description: varchar("description_ledger", { length: 255 }),
  referralId: varchar("referral_id_ledger", { length: 64 }),
  redemptionId: varchar("redemption_id_ledger", { length: 64 }),
  expiresAt: timestamp("expires_at_ledger"),
  createdAt: timestamp("created_at_ledger").defaultNow().notNull(),
});
export type PointsLedger = typeof pointsLedger.$inferSelect;
export type InsertPointsLedger = typeof pointsLedger.$inferInsert;

// reward_tiers: admin-configurable list of rewards customers can redeem
export const rewardTiers = mysqlTable("reward_tiers", {
  id: int("id").autoincrement().primaryKey(),
  tierId: varchar("tier_id", { length: 64 }).notNull().unique(),
  name: varchar("name_tier", { length: 255 }).notNull(),
  description: text("description_tier"),
  pointCost: int("point_cost_tier").notNull(),
  isActive: mysqlEnum("is_active_tier", ["yes", "no"]).default("yes").notNull(),
  sortOrder: int("sort_order_tier").default(0).notNull(),
  createdAt: timestamp("created_at_tier").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_tier").defaultNow().onUpdateNow().notNull(),
});
export type RewardTier = typeof rewardTiers.$inferSelect;
export type InsertRewardTier = typeof rewardTiers.$inferInsert;

// redemptions: tracks when a customer redeems points for a reward
export const redemptions = mysqlTable("redemptions", {
  id: int("id").autoincrement().primaryKey(),
  redemptionId: varchar("redemption_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id_redemption", { length: 64 }).notNull(),
  tierId: varchar("tier_id_redemption", { length: 64 }).notNull(),
  tierName: varchar("tier_name_redemption", { length: 255 }).notNull(),
  pointsSpent: int("points_spent_redemption").notNull(),
  status: mysqlEnum("status_redemption", ["pending", "applied", "cancelled"]).default("pending").notNull(),
  notes: text("notes_redemption"),
  createdAt: timestamp("created_at_redemption").defaultNow().notNull(),
  appliedAt: timestamp("applied_at_redemption"),
  fulfilledBy: varchar("fulfilled_by_redemption", { length: 255 }),
  fulfilledByEmployeeId: varchar("fulfilled_by_employee_id_redemption", { length: 64 }),
});
export type Redemption = typeof redemptions.$inferSelect;
export type InsertRedemption = typeof redemptions.$inferInsert;


// ─── Price Book ───────────────────────────────────────────────────────────────
// Stores admin-managed services that appear in the job booking wizard
export const priceBookServices = mysqlTable("price_book_services", {
  id: int("id").autoincrement().primaryKey(),
  serviceId: varchar("service_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  emoji: varchar("emoji", { length: 8 }).default("🚗").notNull(),
  description: text("description"),
  features: text("features"),              // JSON array of feature strings
  vehiclePrices: text("vehicle_prices").notNull(), // JSON: { sedan, suv, xl_suv_van, truck }
  imageUrl: text("image_url_pb"),                   // S3 URL for the service photo shown on booking form
  isActive: mysqlEnum("is_active_pb", ["yes", "no"]).default("yes").notNull(),
  sortOrder: int("sort_order_pb").default(0).notNull(),
  createdAt: timestamp("created_at_pb").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_pb").defaultNow().onUpdateNow().notNull(),
});
export type PriceBookService = typeof priceBookServices.$inferSelect;
export type InsertPriceBookService = typeof priceBookServices.$inferInsert;

// ─── Geocode Cache ────────────────────────────────────────────────────────────
// Caches geocoded lat/lng for addresses so we don't re-hit Nominatim on every request
export const geocodeCache = mysqlTable("geocode_cache", {
  id: int("id").autoincrement().primaryKey(),
  addressHash: varchar("address_hash", { length: 64 }).notNull().unique(), // MD5 of normalized address
  address: varchar("address", { length: 512 }).notNull(),
  lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
  createdAt: timestamp("created_at_gc").defaultNow().notNull(),
});
export type GeocodeCache = typeof geocodeCache.$inferSelect;
export type InsertGeocodeCache = typeof geocodeCache.$inferInsert;

// ─── Meeting Attendance ───────────────────────────────────────────────────────
// Records when a team member taps "Join Now" on the morning meeting banner.
// One row per employee per meeting date.
export const meetingAttendance = mysqlTable("meeting_attendance", {
  id: int("id").autoincrement().primaryKey(),
  attendanceId: varchar("attendance_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  meetingDate: varchar("meeting_date", { length: 16 }).notNull(), // YYYY-MM-DD in CST
  attendedAt: timestamp("attended_at").defaultNow().notNull(),
});
export type MeetingAttendance = typeof meetingAttendance.$inferSelect;
export type InsertMeetingAttendance = typeof meetingAttendance.$inferInsert;

// ─── Employee Days Off ────────────────────────────────────────────────────────
// Tracks scheduled days off for team members so the auto-deduction monitor
// and morning meeting banner skip them on those dates.
export const employeeDaysOff = mysqlTable("employee_days_off", {
  id: int("id").autoincrement().primaryKey(),
  dayOffId: varchar("day_off_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id_do", { length: 64 }).notNull(),
  fullName: varchar("full_name_do", { length: 255 }).notNull(),
  offDate: varchar("off_date", { length: 16 }).notNull(), // YYYY-MM-DD in CST
  reason: mysqlEnum("reason_do", ["pto", "sick", "personal", "other"]).default("pto").notNull(),
  notes: text("notes_do"),
  assignedBy: varchar("assigned_by_do", { length: 255 }),
  createdAt: timestamp("created_at_do").defaultNow().notNull(),
});
export type EmployeeDayOff = typeof employeeDaysOff.$inferSelect;
export type InsertEmployeeDayOff = typeof employeeDaysOff.$inferInsert;

// ─── Team Member Expense Submissions ─────────────────────────────────────────
// Detailers and ops managers submit receipts here for admin review.
export const expenseSubmissions = mysqlTable("expense_submissions", {
  id: int("id").autoincrement().primaryKey(),
  expenseId: varchar("expense_id", { length: 64 }).notNull().unique(),
  employeeId: varchar("employee_id_exp", { length: 64 }).notNull(),
  fullName: varchar("full_name_exp", { length: 255 }).notNull(),
  amount: decimal("amount_exp", { precision: 10, scale: 2 }).notNull(),
  category: mysqlEnum("category_exp", ["fuel", "supplies", "equipment", "car_wash", "food", "other"]).notNull().default("other"),
  note: text("note_exp"),
  receiptUrl: varchar("receipt_url_exp", { length: 1024 }),
  jobId: varchar("job_id_exp", { length: 64 }),
  cityId: varchar("city_id_exp", { length: 64 }),
  status: mysqlEnum("status_exp", ["pending", "approved", "rejected"]).notNull().default("pending"),
  adminNote: text("admin_note_exp"),
  reviewedBy: varchar("reviewed_by_exp", { length: 255 }),
  reviewedAt: timestamp("reviewed_at_exp"),
  submittedAt: timestamp("submitted_at_exp").defaultNow().notNull(),
});
export type ExpenseSubmission = typeof expenseSubmissions.$inferSelect;
export type InsertExpenseSubmission = typeof expenseSubmissions.$inferInsert;

// ─── Interactive Training Modules ─────────────────────────────────────────────
// Stores the 15 hands-on interactive modules (Engine Bay, Wheel Cleaning, etc.)
// Admin can edit title, subtitle, emoji, color, bgColor, stepCount, and reorder them.
export const interactiveModules = mysqlTable("interactive_modules", {
  id: int("id").autoincrement().primaryKey(),
  moduleKey: varchar("module_key", { length: 64 }).notNull().unique(), // e.g. "engine-bay"
  title: varchar("title_im", { length: 255 }).notNull(),
  subtitle: varchar("subtitle_im", { length: 255 }).notNull(),
  emoji: varchar("emoji_im", { length: 16 }).notNull(),
  color: varchar("color_im", { length: 16 }).notNull(),
  bgColor: varchar("bg_color_im", { length: 16 }).notNull(),
  stepCount: int("step_count_im").notNull().default(0),
  route: varchar("route_im", { length: 128 }).notNull(),
  orderIndex: int("order_index_im").notNull().default(0),
  folderId: int("folder_id_im"),
  isActive: tinyint("is_active_im").notNull().default(1),
  createdAt: timestamp("created_at_im").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_im").defaultNow().onUpdateNow().notNull(),
});
export type InteractiveModule = typeof interactiveModules.$inferSelect;
export type InsertInteractiveModule = typeof interactiveModules.$inferInsert;

// ─── Portal Messages (customer ↔ admin in-app chat) ───────────────────────────
// Stores messages sent between customers (via the customer portal) and admins.
// Each conversation is identified by customerId. direction: "inbound" = customer→admin, "outbound" = admin→customer.
export const portalMessages = mysqlTable("portal_messages", {
  id: int("id").autoincrement().primaryKey(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(), // "inbound" | "outbound"
  body: text("body").notNull(),
  imageUrl: text("image_url"), // optional image attachment URL
  sentByEmployeeId: varchar("sent_by_employee_id", { length: 50 }), // null for customer-sent
  sentByName: varchar("sent_by_name", { length: 100 }),
  isRead: tinyint("is_read").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PortalMessage = typeof portalMessages.$inferSelect;
export type InsertPortalMessage = typeof portalMessages.$inferInsert;

// ─── Interactive Module Folders ───────────────────────────────────────────────
// Organizes interactive training modules into collapsible folders (e.g. Van, Exterior, Interior).
export const interactiveModuleFolders = mysqlTable("interactive_module_folders", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name_imf", { length: 128 }).notNull(),
  emoji: varchar("emoji_imf", { length: 16 }).notNull().default("📁"),
  orderIndex: int("order_index_imf").notNull().default(0),
  isCollapsed: tinyint("is_collapsed_imf").notNull().default(0),
  createdAt: timestamp("created_at_imf").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_imf").defaultNow().onUpdateNow().notNull(),
});
export type InteractiveModuleFolder = typeof interactiveModuleFolders.$inferSelect;
export type InsertInteractiveModuleFolder = typeof interactiveModuleFolders.$inferInsert;

// ─── Module Tools / Chemicals / Towels ────────────────────────────────────────
// Per-module list of tools, chemicals, and towels shown on the Tools & Products screen.
export const moduleTools = mysqlTable("module_tools", {
  id: int("id").autoincrement().primaryKey(),
  moduleKey: varchar("module_key", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  photoUrl: varchar("photo_url", { length: 1024 }),
  category: varchar("category", { length: 32 }).notNull().default("tool"), // "tool" | "chemical" | "towel"
  orderIndex: int("order_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type ModuleTool = typeof moduleTools.$inferSelect;
export type InsertModuleTool = typeof moduleTools.$inferInsert;

// ─── Interactive Module Steps ─────────────────────────────────────────────────
// Per-module steps for interactive training modules (managed by admin, shown in training flow).
export const interactiveModuleSteps = mysqlTable("interactive_module_steps", {
  id: int("id").autoincrement().primaryKey(),
  moduleKey: varchar("module_key", { length: 128 }).notNull(),
  stepId: varchar("step_id", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 512 }).notNull(),
  instruction: text("instruction").notNull(),
  area: varchar("area", { length: 255 }),
  question: text("question"),
  choices: json("choices"),
  correctId: varchar("correct_id", { length: 64 }),
  wrongExplanation: text("wrong_explanation"),
  correctExplanation: text("correct_explanation"),
  proTip: text("pro_tip"),
  vehicleImageUrl: text("vehicle_image_url"),
  orderIndex: int("order_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type InteractiveModuleStep = typeof interactiveModuleSteps.$inferSelect;
export type InsertInteractiveModuleStep = typeof interactiveModuleSteps.$inferInsert;

// ─── Email Queue (quiet hours) ─────────────────────────────────────────────────
// Emails triggered outside 7 AM – 8 PM CST are stored here and sent at 7 AM.
export const emailQueue = mysqlTable("email_queue", {
  id: int("id").autoincrement().primaryKey(),
  queueId: varchar("queue_id", { length: 64 }).notNull().unique(),
  to: varchar("to", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  html: text("html").notNull(),
  textBody: text("text_body"),
  type: mysqlEnum("type", ["booking_confirmation", "notification", "review_request", "other"]).notNull().default("other"),
  customerName: varchar("customer_name", { length: 255 }),
  bookingRef: varchar("booking_ref", { length: 64 }),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).notNull().default("pending"),
  sendAfter: datetime("send_after").notNull(),
  sentAt: datetime("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type EmailQueueItem = typeof emailQueue.$inferSelect;
export type InsertEmailQueueItem = typeof emailQueue.$inferInsert;

// ─── Customer Maintenance Records ─────────────────────────────────────────────
export const maintenanceRecords = mysqlTable("maintenance_records", {
  id: int("id").autoincrement().primaryKey(),
  recordId: varchar("record_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  vehicleId: varchar("vehicle_id", { length: 64 }),
  type: mysqlEnum("type", ["oil_change", "wiper_blades", "tire_rotation", "air_filter", "brake_service", "other"]).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  serviceDate: varchar("service_date", { length: 20 }).notNull(),
  mileageAtService: int("mileage_at_service"),
  nextServiceDate: varchar("next_service_date", { length: 20 }),
  nextServiceMileage: int("next_service_mileage"),
  notes: text("notes"),
  createdAt: timestamp("created_at_mr").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_mr").defaultNow().onUpdateNow().notNull(),
});
export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type InsertMaintenanceRecord = typeof maintenanceRecords.$inferInsert;

// ─── Customer Warranty Documents ──────────────────────────────────────────────
export const warrantyDocs = mysqlTable("warranty_docs", {
  id: int("id").autoincrement().primaryKey(),
  docId: varchar("doc_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  vehicleId: varchar("vehicle_id", { length: 64 }),
  category: mysqlEnum("category", ["battery", "tire", "brake", "other"]).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  fileUrl: varchar("file_url", { length: 1024 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  expiryDate: varchar("expiry_date", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("created_at_wd").defaultNow().notNull(),
});
export type WarrantyDoc = typeof warrantyDocs.$inferSelect;
export type InsertWarrantyDoc = typeof warrantyDocs.$inferInsert;

// ─── Standalone Invoices ────────────────────────────────────────────────────
export const standaloneInvoices = mysqlTable("standalone_invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: varchar("invoice_id", { length: 64 }).notNull().unique(),
  invoiceNumber: varchar("invoice_number", { length: 32 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 32 }),
  notes: text("notes"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  status: mysqlEnum("status", ["draft", "sent", "paid", "partial", "void"]).notNull().default("draft"),
  paymentMethod: varchar("payment_method", { length: 64 }),
  paymentNote: text("payment_note"),
  dueDate: varchar("due_date", { length: 20 }),
  sentAt: timestamp("sent_at"),
  paidAt: timestamp("paid_at"),
  createdBy: varchar("created_by", { length: 64 }),
  createdAt: timestamp("created_at_si").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_si").defaultNow().onUpdateNow().notNull(),
});
export type StandaloneInvoice = typeof standaloneInvoices.$inferSelect;
export type InsertStandaloneInvoice = typeof standaloneInvoices.$inferInsert;

export const invoiceLineItems = mysqlTable("invoice_line_items", {
  id: int("id").autoincrement().primaryKey(),
  lineId: varchar("line_id", { length: 64 }).notNull().unique(),
  invoiceId: varchar("invoice_id", { length: 64 }).notNull(),
  description: varchar("description", { length: 512 }).notNull(),
  quantity: decimal("quantity", { precision: 8, scale: 2 }).notNull().default("1"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  lineTotal: decimal("line_total", { precision: 10, scale: 2 }).notNull().default("0"),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("created_at_ili").defaultNow().notNull(),
});
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InsertInvoiceLineItem = typeof invoiceLineItems.$inferInsert;

// ─── Chat Last Seen ──────────────────────────────────────────────────────────
// Tracks the last time each employee "saw" messages in each chat channel/DM.
// Used to compute unread counts for the in-app banner.
export const chatLastSeen = mysqlTable("chat_last_seen", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  // channel key: 'ptt', 'general', 'admin', 'detailers', 'sales', 'door_hangers', 'community'
  // or 'dm:{otherEmployeeId}' for direct messages
  channelKey: varchar("channel_key", { length: 128 }).notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_cls").defaultNow().onUpdateNow().notNull(),
});
export type ChatLastSeen = typeof chatLastSeen.$inferSelect;
export type InsertChatLastSeen = typeof chatLastSeen.$inferInsert;

// ─── Job Events ──────────────────────────────────────────────────────────────
// Tracks job lifecycle events (created, cancelled, rescheduled) so detailers
// can see an in-app banner and never miss a job update.
export const jobEvents = mysqlTable("job_events", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull(),
  eventType: mysqlEnum("event_type", ["created", "cancelled", "rescheduled", "reassigned"]).notNull(),
  customerName: varchar("customer_name", { length: 255 }),
  location: varchar("location", { length: 64 }),
  dateStr: varchar("date_str", { length: 20 }),
  timeSlot: varchar("time_slot", { length: 64 }),
  assignedTo: varchar("assigned_to", { length: 64 }),
  createdAt: timestamp("created_at_je").defaultNow().notNull(),
});
export type JobEvent = typeof jobEvents.$inferSelect;
export type InsertJobEvent = typeof jobEvents.$inferInsert;

// Tracks which employees have seen which job events (for unread banner)
export const jobEventSeen = mysqlTable("job_event_seen", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: varchar("employee_id", { length: 64 }).notNull(),
  jobEventId: int("job_event_id").notNull(),
  seenAt: timestamp("seen_at").defaultNow().notNull(),
});
export type JobEventSeen = typeof jobEventSeen.$inferSelect;
export type InsertJobEventSeen = typeof jobEventSeen.$inferInsert;

// ─── QC Records ──────────────────────────────────────────────────────────────
// One record per job per QC review. Created on first interaction (call or result save).
export const qcRecords = mysqlTable("qc_records", {
  id: int("id").autoincrement().primaryKey(),
  qcId: varchar("qc_id", { length: 64 }).notNull().unique(),
  jobId: varchar("job_id", { length: 64 }).notNull().unique(), // one QC record per job
  jobDate: varchar("job_date", { length: 16 }).notNull(),      // YYYY-MM-DD
  customerName: varchar("customer_name", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 32 }),
  detailerName: varchar("detailer_name", { length: 255 }),
  city: varchar("city", { length: 128 }),
  packageType: varchar("package_type", { length: 64 }),
  // Call tracking
  calledAt: datetime("called_at"),                            // when ops manager tapped Call
  callConfirmed: tinyint("call_confirmed").default(0).notNull(), // 1 = call was logged
  callOutcome: varchar("call_outcome", { length: 32 }),         // satisfied|issue_reported|no_answer|voicemail
  twilioCallSid: varchar("twilio_call_sid", { length: 64 }),    // Twilio call SID for masked calls
  callDurationSeconds: int("call_duration_seconds"),            // call duration in seconds
  callerPhone: varchar("caller_phone", { length: 32 }),         // the ops/admin phone that was bridged
  // QC result
  status: mysqlEnum("status_qc", ["pending", "pass", "fail"]).default("pending").notNull(),
  feedback: text("feedback"),                                 // notes from the call
  // Who did the QC
  reviewedBy: varchar("reviewed_by", { length: 255 }),
  reviewedById: varchar("reviewed_by_id", { length: 64 }),
  createdAt: timestamp("created_at_qc").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_qc").defaultNow().onUpdateNow().notNull(),
});
export type QcRecord = typeof qcRecords.$inferSelect;
export type InsertQcRecord = typeof qcRecords.$inferInsert;

// ─── Ops Daily Checklist table ─────────────────────────────────────────────────
export const opsDailyChecklist = mysqlTable("ops_daily_checklist", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date_odc", { length: 16 }).notNull(),          // YYYY-MM-DD CST
  opsManagerId: varchar("ops_manager_id_odc", { length: 64 }).notNull(),
  // Numeric tasks (count completed today)
  siteInspections: int("site_inspections_odc").notNull().default(0),   // min 2
  vanInspections: int("van_inspections_odc").notNull().default(0),     // min 2
  doorHangers: int("door_hangers_odc").notNull().default(0),           // min 100
  // Boolean tasks
  inventoryCheck: tinyint("inventory_check_odc").notNull().default(0),
  morningTeamCheckIn: tinyint("morning_team_check_in_odc").notNull().default(0),   // before noon
  afternoonTeamCheckIn: tinyint("afternoon_team_check_in_odc").notNull().default(0), // ~2:30 PM
  qcCallsDone: tinyint("qc_calls_done_odc").notNull().default(0),
  updatedAt: timestamp("updated_at_odc").defaultNow().onUpdateNow().notNull(),
});
export type OpsDailyChecklist = typeof opsDailyChecklist.$inferSelect;
export type InsertOpsDailyChecklist = typeof opsDailyChecklist.$inferInsert;

// ─── Tip Requests ─────────────────────────────────────────────────────────────
export const tipRequests = mysqlTable("tip_requests", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  jobId: varchar("job_id", { length: 64 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 320 }).notNull(),
  detailerName: varchar("detailer_name", { length: 255 }),
  serviceTitle: varchar("service_title", { length: 255 }),
  serviceTotal: decimal("service_total", { precision: 10, scale: 2 }).notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 128 }).notNull(),
  stripePaymentMethodId: varchar("stripe_payment_method_id", { length: 128 }).notNull(),
  cardLast4: varchar("card_last4", { length: 4 }),
  cardBrand: varchar("card_brand", { length: 32 }),
  tipAmountCents: int("tip_amount_cents"),
  tipPaymentIntentId: varchar("tip_payment_intent_id", { length: 128 }),
  status: mysqlEnum("status", ["pending", "completed", "skipped", "expired"]).default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at_tr").defaultNow().notNull(),
  completedAt: timestamp("completed_at_tr"),
});
export type TipRequest = typeof tipRequests.$inferSelect;
export type InsertTipRequest = typeof tipRequests.$inferInsert;

// ── In-app messaging between customer and detailer ──────────────────────────
export const jobMessages = mysqlTable("job_messages", {
  id: int("id").autoincrement().primaryKey(),
  bookingRef: varchar("booking_ref", { length: 100 }).notNull(),
  senderType: varchar("sender_type", { length: 20 }).notNull(), // 'customer' | 'detailer'
  senderId: varchar("sender_id", { length: 100 }).notNull(),
  senderName: varchar("sender_name", { length: 100 }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
});


// ─── Package Images (remote-configurable, no rebuild needed) ───
export const packageImages = mysqlTable("package_images", {
  id: int("id").autoincrement().primaryKey(),
  packageId: varchar("package_id", { length: 64 }).notNull().unique(),
  imageUrl: text("image_url").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type PackageImage = typeof packageImages.$inferSelect;
export type InsertPackageImage = typeof packageImages.$inferInsert;

// ─── Refund Records ─────────────────────────────────────────────────────────────
// Logs every admin-issued Stripe refund for audit and display purposes.
export const refundRecords = mysqlTable("refund_records", {
  id: int("id").autoincrement().primaryKey(),
  refundRecordId: varchar("refund_record_id", { length: 64 }).notNull().unique(),
  jobId: varchar("job_id", { length: 64 }),
  bookingId: varchar("booking_id", { length: 64 }),
  paymentIntentId: varchar("payment_intent_id", { length: 128 }).notNull(),
  stripeRefundId: varchar("stripe_refund_id", { length: 128 }),
  amountCents: int("amount_cents").notNull(),
  reason: varchar("reason", { length: 64 }).notNull().default("requested_by_customer"),
  adminNote: text("admin_note"),
  issuedBy: varchar("issued_by", { length: 128 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }),
  customerEmail: varchar("customer_email", { length: 255 }),
  status: varchar("status", { length: 32 }).notNull().default("succeeded"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RefundRecord = typeof refundRecords.$inferSelect;

// ─── Customer Activity Sessions ───────────────────────────────────────────────
// Tracks each time a portal customer opens the app, how long they stay, and
// what their last active screen was. Admin-only visibility.
export const customerActivitySessions = mysqlTable("customer_activity_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("session_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }).notNull(),
  source: mysqlEnum("source", ["portal_app", "website"]).default("portal_app").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  durationSeconds: int("duration_seconds"),   // null until session ends
  lastScreen: varchar("last_screen", { length: 128 }),
  devicePlatform: varchar("device_platform", { length: 32 }), // "ios" | "android" | "web"
  appVersion: varchar("app_version", { length: 32 }),
});
export type CustomerActivitySession = typeof customerActivitySessions.$inferSelect;
export type InsertCustomerActivitySession = typeof customerActivitySessions.$inferInsert;

// ─── Abandoned Cart Records ───────────────────────────────────────────────────
// Records when a customer starts the booking checkout flow but doesn't complete it.
// source: "portal_app" = mobile app, "website" = web booking form.
export const abandonedCarts = mysqlTable("abandoned_carts", {
  id: int("id").autoincrement().primaryKey(),
  cartId: varchar("cart_id", { length: 64 }).notNull().unique(),
  customerId: varchar("customer_id", { length: 64 }),   // null for anonymous website visitors
  source: mysqlEnum("source", ["portal_app", "website"]).notNull(),
  packageId: varchar("package_id", { length: 64 }),
  packageName: varchar("package_name", { length: 128 }),
  vehicleType: varchar("vehicle_type", { length: 32 }),
  selectedDate: varchar("selected_date", { length: 16 }),
  estimatedTotal: decimal("estimated_total", { precision: 10, scale: 2 }),
  stepReached: varchar("step_reached", { length: 64 }),  // e.g. "date_selection", "payment", "confirmation"
  city: varchar("city", { length: 128 }),
  customerEmail: varchar("customer_email", { length: 320 }),
  customerName: varchar("customer_name", { length: 255 }),
  completedAt: timestamp("completed_at"),   // set when booking is completed (not abandoned)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type AbandonedCart = typeof abandonedCarts.$inferSelect;
export type InsertAbandonedCart = typeof abandonedCarts.$inferInsert;

// ─── Inactive Loan Contract Tables ──────────────────────────────────────────────
// Retained for safe archival only. No active routes, screens, or jobs reference these tables.
export const loanContracts = mysqlTable("loan_contracts", {
  id: int("id").autoincrement().primaryKey(),
  loanId: varchar("loan_id", { length: 64 }).notNull().unique(),
  borrowerName: varchar("borrower_name", { length: 255 }).notNull(),
  borrowerEmail: varchar("borrower_email", { length: 255 }).notNull(),
  borrowerPhone: varchar("borrower_phone", { length: 20 }),
  principalAmount: decimal("principal_amount", { precision: 12, scale: 2 }).notNull(),
  totalRepaymentAmount: decimal("total_repayment_amount", { precision: 12, scale: 2 }).notNull(),
  numberOfPayments: int("number_of_payments").notNull(),
  paymentFrequency: mysqlEnum("payment_frequency", ["weekly", "biweekly", "monthly"]).notNull(),
  paymentDayOfWeek: int("payment_day_of_week"),
  paymentDayOfMonth: varchar("payment_day_of_month", { length: 50 }),
  startDate: date("start_date").notNull(),
  status: mysqlEnum("status_lc", ["draft", "pending_signature", "active", "completed", "cancelled"]).default("draft").notNull(),
  contractUrl: text("contract_url"),
  signedContractUrl: text("signed_contract_url"),
  contractSignedAt: datetime("contract_signed_at"),
  signatureDate: datetime("signature_date"),
  createdAt: timestamp("created_at_lc").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_lc").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  borrowerEmailIdx: index("borrower_email_idx").on(table.borrowerEmail),
  statusIdx: index("status_lc_idx").on(table.status),
  startDateIdx: index("start_date_idx").on(table.startDate),
}));
export type LoanContract = typeof loanContracts.$inferSelect;
export type InsertLoanContract = typeof loanContracts.$inferInsert;

export const loanPaymentSchedules = mysqlTable("loan_payment_schedules", {
  id: int("id").autoincrement().primaryKey(),
  scheduleId: varchar("schedule_id", { length: 64 }).notNull().unique(),
  loanId: varchar("loan_id_lps", { length: 64 }).notNull(),
  paymentNumber: int("payment_number").notNull(),
  dueDate: date("due_date").notNull(),
  amountDue: decimal("amount_due", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status_lps", ["scheduled", "pending", "completed", "missed", "delayed"]).default("scheduled").notNull(),
  reminderSentAt: datetime("reminder_sent_at"),
  createdAt: timestamp("created_at_lps").defaultNow().notNull(),
  updatedAt: timestamp("updated_at_lps").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  loanIdIdx: index("loan_id_lps_idx").on(table.loanId),
  dueDateIdx: index("due_date_idx").on(table.dueDate),
  statusIdx: index("status_lps_idx").on(table.status),
}));
export type LoanPaymentSchedule = typeof loanPaymentSchedules.$inferSelect;
export type InsertLoanPaymentSchedule = typeof loanPaymentSchedules.$inferInsert;

export const loanPayments = mysqlTable("loan_payments", {
  id: int("id").autoincrement().primaryKey(),
  paymentId: varchar("payment_id", { length: 64 }).notNull().unique(),
  loanId: varchar("loan_id_lp", { length: 64 }).notNull(),
  scheduleId: varchar("schedule_id_lp", { length: 64 }),
  paymentNumber: int("payment_number_lp").notNull(),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull(),
  paidDate: date("paid_date").notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }),
  notes: text("notes_lp"),
  recordedBy: varchar("recorded_by", { length: 255 }),
  createdAt: timestamp("created_at_lp").defaultNow().notNull(),
}, (table) => ({
  loanIdIdx: index("loan_id_lp_idx").on(table.loanId),
  paidDateIdx: index("paid_date_idx").on(table.paidDate),
}));
export type LoanPayment = typeof loanPayments.$inferSelect;
export type InsertLoanPayment = typeof loanPayments.$inferInsert;

export const loanPaymentReminders = mysqlTable("loan_payment_reminders", {
  id: int("id").autoincrement().primaryKey(),
  reminderId: varchar("reminder_id", { length: 64 }).notNull().unique(),
  loanId: varchar("loan_id_lpr", { length: 64 }).notNull(),
  scheduleId: varchar("schedule_id_lpr", { length: 64 }).notNull(),
  reminderType: mysqlEnum("reminder_type", ["payment_due", "payment_overdue", "contract_pending"]).notNull(),
  sentAt: datetime("sent_at").notNull(),
  createdAt: timestamp("created_at_lpr").defaultNow().notNull(),
}, (table) => ({
  loanIdIdx: index("loan_id_lpr_idx").on(table.loanId),
  scheduleIdIdx: index("schedule_id_lpr_idx").on(table.scheduleId),
}));
export type LoanPaymentReminder = typeof loanPaymentReminders.$inferSelect;
export type InsertLoanPaymentReminder = typeof loanPaymentReminders.$inferInsert;
