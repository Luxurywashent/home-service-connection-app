ALTER TABLE `schedule_jobs` ADD `payment_method` varchar(32);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_intent_id` varchar(128);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_subtotal` decimal(10,2);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_tip` decimal(10,2);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_total` decimal(10,2);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_paid_at` varchar(64);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_signature_url` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `payment_reference_note` varchar(255);