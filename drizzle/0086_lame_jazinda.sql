ALTER TABLE `sales_callbacks` ADD `source_callback` enum('sales_rep','detailer_referral','portal','manual') DEFAULT 'sales_rep' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_callbacks` ADD `referred_by` varchar(64);--> statement-breakpoint
ALTER TABLE `sales_callbacks` ADD `referred_by_name` varchar(128);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `is_new_customer` tinyint DEFAULT 0;