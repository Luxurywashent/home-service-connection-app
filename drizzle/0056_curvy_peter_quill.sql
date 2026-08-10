CREATE TABLE `eod_checklist_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` varchar(64) NOT NULL,
	`checklist_id` varchar(64) NOT NULL,
	`step_key` enum('trash_removed','chemicals_stocked','towels_stocked') NOT NULL,
	`photo_url` text,
	`completed_at` datetime,
	CONSTRAINT `eod_checklist_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `eod_checklist_items_item_id_unique` UNIQUE(`item_id`)
);
--> statement-breakpoint
CREATE TABLE `eod_checklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checklist_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`date` varchar(16) NOT NULL,
	`status_eod` enum('pending','submitted','approved','violated') NOT NULL DEFAULT 'pending',
	`submitted_at` datetime,
	`reviewed_by` varchar(64),
	`reviewed_at` datetime,
	`review_note` text,
	`created_at_eod` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `eod_checklists_id` PRIMARY KEY(`id`),
	CONSTRAINT `eod_checklists_checklist_id_unique` UNIQUE(`checklist_id`)
);
--> statement-breakpoint
CREATE TABLE `geofence_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`zone_id` varchar(64) NOT NULL,
	`zone_name` varchar(255),
	`event_type` enum('enter','exit') NOT NULL,
	`latitude_gfe` double,
	`longitude_gfe` double,
	`created_at_gfe` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `geofence_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `geofence_events_event_id_unique` UNIQUE(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `geofence_zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zone_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` varchar(512) NOT NULL,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`radius_meters` int NOT NULL DEFAULT 402,
	`is_active` tinyint NOT NULL DEFAULT 1,
	`created_by` varchar(64),
	`created_at_gz` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `geofence_zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `geofence_zones_zone_id_unique` UNIQUE(`zone_id`)
);
