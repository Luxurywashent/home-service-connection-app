ALTER TABLE `portal_messages` MODIFY COLUMN `customer_id` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `interactive_module_steps` ADD `vehicle_image_url` text;