CREATE TABLE `training_quiz_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`attempt_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`module_id` varchar(64) NOT NULL,
	`score` int NOT NULL,
	`total_questions` int NOT NULL,
	`answers` text,
	`passed_tqa` enum('yes','no') NOT NULL DEFAULT 'no',
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_quiz_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_quiz_attempts_attempt_id_unique` UNIQUE(`attempt_id`)
);
--> statement-breakpoint
CREATE TABLE `training_quiz_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`module_id` varchar(64) NOT NULL,
	`question_text` text NOT NULL,
	`option_a` varchar(512) NOT NULL,
	`option_b` varchar(512) NOT NULL,
	`option_c` varchar(512) NOT NULL,
	`option_d` varchar(512) NOT NULL,
	`correct_answer_tq` enum('A','B','C','D') NOT NULL,
	`order_index_tq` int NOT NULL DEFAULT 0,
	`created_at_tq` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_quiz_questions_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_quiz_questions_question_id_unique` UNIQUE(`question_id`)
);
