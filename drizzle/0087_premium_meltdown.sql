ALTER TABLE `interactive_modules` MODIFY COLUMN `folder_id_im` int;--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `payment_method` varchar(32);--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `payment_intent_id` varchar(128);--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `payment_total` decimal(10,2);--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `payment_paid_at` varchar(64);--> statement-breakpoint
ALTER TABLE `qc_records` ADD `call_outcome` varchar(32);--> statement-breakpoint
ALTER TABLE `qc_records` ADD `twilio_call_sid` varchar(64);--> statement-breakpoint
ALTER TABLE `qc_records` ADD `call_duration_seconds` int;--> statement-breakpoint
ALTER TABLE `qc_records` ADD `caller_phone` varchar(32);