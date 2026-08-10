CREATE TABLE `geocode_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`address_hash` varchar(64) NOT NULL,
	`address` varchar(512) NOT NULL,
	`lat` decimal(10,7) NOT NULL,
	`lng` decimal(10,7) NOT NULL,
	`created_at_gc` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `geocode_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `geocode_cache_address_hash_unique` UNIQUE(`address_hash`)
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `shift` enum('shift1','shift2') DEFAULT 'shift1' NOT NULL;