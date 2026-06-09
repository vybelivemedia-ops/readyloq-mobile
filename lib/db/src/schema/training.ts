import { pgTable, serial, text, integer, real, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const quizzesTable = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  difficulty: text("difficulty").notNull().default("medium"), // "easy" | "medium" | "hard"
  questionCount: integer("question_count").notNull().default(0),
  passingScore: integer("passing_score").notNull().default(70),
  questions: jsonb("questions").$type<QuizQuestion[]>().default([]),
  averageScore: real("average_score"),
  completedCount: integer("completed_count").notNull().default(0),
});

export const trainingScoresTable = pgTable("training_scores", {
  id: serial("id").primaryKey(),
  technicianName: text("technician_name").notNull(),
  technicianId: text("technician_id"),
  quizId: integer("quiz_id").notNull().references(() => quizzesTable.id),
  quizTitle: text("quiz_title").notNull(),
  score: real("score").notNull(),
  passed: boolean("passed").notNull(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});

export interface QuizQuestion {
  id: number;
  imageUrl: string;
  question: string;
  options: string[];
  correctOption: number;
  explanation: string | null;
}

export const insertQuizSchema = createInsertSchema(quizzesTable).omit({ id: true });
export const insertTrainingScoreSchema = createInsertSchema(trainingScoresTable).omit({ id: true, completedAt: true });

export type Quiz = typeof quizzesTable.$inferSelect;
export type TrainingScore = typeof trainingScoresTable.$inferSelect;
export type InsertTrainingScore = z.infer<typeof insertTrainingScoreSchema>;
