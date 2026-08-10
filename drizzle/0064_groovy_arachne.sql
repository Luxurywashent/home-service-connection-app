CREATE TABLE `service_location_detailers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`location_id_sld` varchar(64) NOT NULL,
	`employee_id_sld` varchar(64) NOT NULL,
	`is_primary_sld` tinyint NOT NULL DEFAULT 0,
	`created_at_sld` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `service_location_detailers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`location_id_sl` varchar(64) NOT NULL,
	`name_sl` varchar(128) NOT NULL,
	`slug_sl` varchar(64) NOT NULL,
	`state_sl` varchar(4) NOT NULL DEFAULT 'FL',
	`is_active_sl` tinyint NOT NULL DEFAULT 1,
	`sort_order_sl` int NOT NULL DEFAULT 0,
	`zapier_webhook_url_sl` varchar(512),
	`thank_you_page_url_sl` varchar(512),
	`booking_url_sl` varchar(512),
	`available_days_sl` text,
	`start_hour_sl` int DEFAULT 8,
	`end_hour_sl` int DEFAULT 18,
	`slot_duration_sl` int DEFAULT 60,
	`latitude_sl` varchar(32),
	`longitude_sl` varchar(32),
	`radius_meters_sl` int DEFAULT 40000,
	`notes_sl` text,
	`created_at_sl` timestamp NOT NULL DEFAULT (now()),
	`updated_at_sl` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `service_locations_location_id_sl_unique` UNIQUE(`location_id_sl`),
	CONSTRAINT `service_locations_slug_sl_unique` UNIQUE(`slug_sl`)
);
