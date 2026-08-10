CREATE TABLE `community_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`comment_id` varchar(64) NOT NULL,
	`post_id` varchar(64) NOT NULL,
	`author_id` varchar(255) NOT NULL,
	`author_name` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`like_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `community_comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `community_comments_comment_id_unique` UNIQUE(`comment_id`)
);
--> statement-breakpoint
CREATE TABLE `community_post_likes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`post_id` varchar(64) NOT NULL,
	`employee_id` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `community_post_likes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`post_id` varchar(64) NOT NULL,
	`author_id` varchar(255) NOT NULL,
	`author_name` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`category` varchar(64) DEFAULT 'General',
	`is_pinned` int NOT NULL DEFAULT 0,
	`like_count` int NOT NULL DEFAULT 0,
	`comment_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `community_posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `community_posts_post_id_unique` UNIQUE(`post_id`)
);
