CREATE TABLE `price_book_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`emoji` varchar(8) NOT NULL DEFAULT '🚗',
	`description` text,
	`features` text,
	`vehicle_prices` text NOT NULL,
	`is_active_pb` enum('yes','no') NOT NULL DEFAULT 'yes',
	`sort_order_pb` int NOT NULL DEFAULT 0,
	`created_at_pb` timestamp NOT NULL DEFAULT (now()),
	`updated_at_pb` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `price_book_services_id` PRIMARY KEY(`id`),
	CONSTRAINT `price_book_services_service_id_unique` UNIQUE(`service_id`)
);
