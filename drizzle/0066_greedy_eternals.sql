CREATE TABLE `interactive_step_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`override_key` varchar(128) NOT NULL,
	`module_id_iso` varchar(64) NOT NULL,
	`step_index_iso` int NOT NULL,
	`title_iso` varchar(512),
	`instruction_iso` text,
	`area_iso` varchar(128),
	`question_iso` text,
	`pro_tip_iso` text,
	`choice_labels_iso` text,
	`vehicle_image_url_iso` text,
	`created_at_iso` timestamp NOT NULL DEFAULT (now()),
	`updated_at_iso` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interactive_step_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `interactive_step_overrides_override_key_unique` UNIQUE(`override_key`)
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`promo_id` varchar(64) NOT NULL,
	`title_promo` varchar(128) NOT NULL,
	`description_promo` text,
	`discount_type_promo` enum('percent','fixed','none') NOT NULL DEFAULT 'none',
	`discount_value_promo` decimal(10,2) DEFAULT '0',
	`promo_code_promo` varchar(64),
	`bg_color_promo` varchar(32) NOT NULL DEFAULT '#0057FF',
	`emoji_promo` varchar(16) NOT NULL DEFAULT '🎉',
	`start_date_promo` varchar(16),
	`end_date_promo` varchar(16),
	`is_active_promo` tinyint NOT NULL DEFAULT 1,
	`created_by_promo` varchar(64),
	`created_at_promo` timestamp NOT NULL DEFAULT (now()),
	`updated_at_promo` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `promotions_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotions_promo_id_unique` UNIQUE(`promo_id`)
);
