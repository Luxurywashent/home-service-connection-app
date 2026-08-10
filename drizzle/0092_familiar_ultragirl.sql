ALTER TABLE `customer_bookings` MODIFY COLUMN `vehicle_type` enum('sedan','suv','large_suv_van','truck','rv') NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_vehicles` MODIFY COLUMN `vehicle_type` enum('sedan','suv','large_suv_van','truck','rv') NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_jobs` MODIFY COLUMN `source` enum('manual','online','portal_app') NOT NULL DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `customer_vehicles` ADD `rv_class` varchar(64);--> statement-breakpoint
ALTER TABLE `customer_vehicles` ADD `rv_length_ft` int;--> statement-breakpoint
ALTER TABLE `portal_messages` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `price_book_services` ADD `image_url_pb` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `addon_qtys` text;