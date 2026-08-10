CREATE TABLE `company_meetings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`meeting_id` varchar(64) NOT NULL,
	`title_cm` varchar(255) NOT NULL,
	`description_cm` text,
	`meeting_date` varchar(16) NOT NULL,
	`meeting_time_cm` varchar(8) NOT NULL,
	`zoom_link_cm` text,
	`is_recurring` enum('yes','no') NOT NULL DEFAULT 'no',
	`recurring_day` varchar(16),
	`status_cm` enum('upcoming','cancelled','completed') NOT NULL DEFAULT 'upcoming',
	`created_by_cm` varchar(64),
	`created_at_cm` timestamp NOT NULL DEFAULT (now()),
	`updated_at_cm` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `company_meetings_id` PRIMARY KEY(`id`),
	CONSTRAINT `company_meetings_meeting_id_unique` UNIQUE(`meeting_id`)
);
--> statement-breakpoint
CREATE TABLE `points_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ledger_id` varchar(64) NOT NULL,
	`customer_id_ledger` varchar(64) NOT NULL,
	`type_ledger` enum('earn','redeem','expire') NOT NULL,
	`points_ledger_val` int NOT NULL,
	`description_ledger` varchar(255),
	`referral_id_ledger` varchar(64),
	`redemption_id_ledger` varchar(64),
	`expires_at_ledger` timestamp,
	`created_at_ledger` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `points_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `points_ledger_ledger_id_unique` UNIQUE(`ledger_id`)
);
--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`redemption_id` varchar(64) NOT NULL,
	`customer_id_redemption` varchar(64) NOT NULL,
	`tier_id_redemption` varchar(64) NOT NULL,
	`tier_name_redemption` varchar(255) NOT NULL,
	`points_spent_redemption` int NOT NULL,
	`status_redemption` enum('pending','applied','cancelled') NOT NULL DEFAULT 'pending',
	`notes_redemption` text,
	`created_at_redemption` timestamp NOT NULL DEFAULT (now()),
	`applied_at_redemption` timestamp,
	CONSTRAINT `redemptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `redemptions_redemption_id_unique` UNIQUE(`redemption_id`)
);
--> statement-breakpoint
CREATE TABLE `referral_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id_ref` varchar(64) NOT NULL,
	`code_ref` varchar(32) NOT NULL,
	`created_at_ref` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referral_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `referral_codes_customer_id_ref_unique` UNIQUE(`customer_id_ref`),
	CONSTRAINT `referral_codes_code_ref_unique` UNIQUE(`code_ref`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referral_id` varchar(64) NOT NULL,
	`referrer_id` varchar(64) NOT NULL,
	`friend_id` varchar(64),
	`friend_email` varchar(255),
	`status_referral` enum('pending','booked','completed','rewarded') NOT NULL DEFAULT 'pending',
	`booking_id_ref` varchar(64),
	`points_awarded` int NOT NULL DEFAULT 0,
	`created_at_referral` timestamp NOT NULL DEFAULT (now()),
	`completed_at_referral` timestamp,
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`),
	CONSTRAINT `referrals_referral_id_unique` UNIQUE(`referral_id`)
);
--> statement-breakpoint
CREATE TABLE `reward_tiers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tier_id` varchar(64) NOT NULL,
	`name_tier` varchar(255) NOT NULL,
	`description_tier` text,
	`point_cost_tier` int NOT NULL,
	`is_active_tier` enum('yes','no') NOT NULL DEFAULT 'yes',
	`sort_order_tier` int NOT NULL DEFAULT 0,
	`created_at_tier` timestamp NOT NULL DEFAULT (now()),
	`updated_at_tier` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reward_tiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `reward_tiers_tier_id_unique` UNIQUE(`tier_id`)
);
--> statement-breakpoint
ALTER TABLE `employee_van_assignments` ADD `shift` varchar(16) DEFAULT 'shift1';--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `appt_confirmation_status` enum('pending','confirmed','no_response') DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `appt_reminder_sent` tinyint DEFAULT 0;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `appt_reminder_sent_at` datetime;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `appt_confirmed_at` datetime;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `appt_confirm_token` varchar(64);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `appt_confirm_method` enum('email','sms');--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `on_my_way_at` datetime;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `arrived_at` datetime;