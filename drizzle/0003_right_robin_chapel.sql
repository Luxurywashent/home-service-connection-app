CREATE TABLE `employee_progression` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`completed_at` timestamp NOT NULL DEFAULT (now()),
	`completed_date` varchar(16) NOT NULL,
	CONSTRAINT `employee_progression_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`order_index` int NOT NULL,
	`question_text` text NOT NULL,
	`option_a` varchar(512) NOT NULL,
	`option_b` varchar(512) NOT NULL,
	`option_c` varchar(512) NOT NULL,
	`option_d` varchar(512),
	`correct_answer` enum('A','B','C','D') NOT NULL,
	`explanation_correct` text,
	`explanation_incorrect` text,
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quiz_questions_id` PRIMARY KEY(`id`),
	CONSTRAINT `quiz_questions_question_id_unique` UNIQUE(`question_id`)
);
