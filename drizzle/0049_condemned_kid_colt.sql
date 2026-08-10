CREATE TABLE `customer_addresses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`address_id` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`label` varchar(64) NOT NULL DEFAULT 'Home',
	`street` varchar(255) NOT NULL,
	`unit` varchar(64),
	`city` varchar(128) NOT NULL,
	`state` varchar(64) NOT NULL,
	`zip` varchar(16) NOT NULL,
	`is_default` tinyint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_addresses_address_id_unique` UNIQUE(`address_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_ref` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`vehicle_id` varchar(64) NOT NULL,
	`vehicle_type` enum('sedan','suv','large_suv_van','truck') NOT NULL,
	`vehicle_label` varchar(255),
	`package_id` varchar(64) NOT NULL,
	`package_name` varchar(128) NOT NULL,
	`addons` text,
	`address_id` varchar(64),
	`address_label` varchar(512),
	`city` varchar(128),
	`scheduled_date` varchar(16) NOT NULL,
	`scheduled_time` varchar(32) NOT NULL,
	`subtotal` decimal(10,2) NOT NULL,
	`total` decimal(10,2) NOT NULL,
	`status` enum('pending','confirmed','en_route','arrived','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
	`assigned_employee_id` varchar(64),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_bookings_booking_ref_unique` UNIQUE(`booking_ref`)
);
--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_token` varchar(255) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_sessions_session_token_unique` UNIQUE(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `customer_vehicles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicle_id` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`year` varchar(8) NOT NULL,
	`make` varchar(64) NOT NULL,
	`model` varchar(128) NOT NULL,
	`vehicle_type` enum('sedan','suv','large_suv_van','truck') NOT NULL,
	`color` varchar(64),
	`is_default` tinyint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_vehicles_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_vehicles_vehicle_id_unique` UNIQUE(`vehicle_id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`first_name` varchar(128) NOT NULL,
	`last_name` varchar(128) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(32),
	`password_hash` varchar(255) NOT NULL,
	`push_token` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_customer_id_unique` UNIQUE(`customer_id`),
	CONSTRAINT `customers_email_unique` UNIQUE(`email`)
);
