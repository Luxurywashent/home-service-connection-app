CREATE TABLE `finance_cities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`city_id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_cities_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_cities_city_id_unique` UNIQUE(`city_id`),
	CONSTRAINT `finance_cities_slug_unique` UNIQUE(`slug`)
);
