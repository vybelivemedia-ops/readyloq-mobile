import { Router } from "express";
import { db } from "@workspace/db";
import { quizzesTable, trainingScoresTable } from "@workspace/db";
import type { QuizQuestion } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

const router = Router();

// GET /training/quizzes
router.get("/quizzes", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(quizzesTable)
      .where(eq(quizzesTable.companyId, companyId));
    return res.json(
      rows.map((q) => ({
        ...q,
        questions: (q.questions ?? []) as QuizQuestion[],
      })),
    );
  } catch (err) {
    return res.status(500).json({ error: "Failed to list quizzes" });
  }
});

// GET /training/quizzes/:id
router.get("/quizzes/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(quizzesTable)
      .where(and(eq(quizzesTable.id, id), eq(quizzesTable.companyId, companyId)));
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json({ ...row, questions: (row.questions ?? []) as QuizQuestion[] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get quiz" });
  }
});

// POST /training/quizzes/:id/submit
router.post("/quizzes/:id/submit", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const { answers } = req.body;
    if (!answers) return res.status(400).json({ error: "answers is required" });

    const [quiz] = await db
      .select()
      .from(quizzesTable)
      .where(and(eq(quizzesTable.id, id), eq(quizzesTable.companyId, companyId)));
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    const questions = (quiz.questions ?? []) as QuizQuestion[];
    const answerMap = new Map(answers.map((a: any) => [a.questionId, a.selectedOption]));

    let correct = 0;
    const feedback = questions.map((q) => {
      const selected = answerMap.get(q.id);
      const isCorrect = selected === q.correctOption;
      if (isCorrect) correct++;
      return { questionId: q.id, correct: isCorrect, explanation: q.explanation };
    });

    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const passed = score >= quiz.passingScore;

    // Update quiz stats
    const newCompleted = quiz.completedCount + 1;
    const allScores = await db
      .select()
      .from(trainingScoresTable)
      .where(
        and(
          eq(trainingScoresTable.companyId, companyId),
          eq(trainingScoresTable.quizId, id),
        ),
      );
    const avgScore =
      allScores.length > 0
        ? (allScores.reduce((s, r) => s + r.score, 0) + score) / (allScores.length + 1)
        : score;

    await db
      .update(quizzesTable)
      .set({
        completedCount: newCompleted,
        averageScore: Math.round(avgScore * 10) / 10,
      })
      .where(and(eq(quizzesTable.id, id), eq(quizzesTable.companyId, companyId)));

    return res.json({
      quizId: id,
      score,
      passed,
      totalQuestions: questions.length,
      correctAnswers: correct,
      feedback,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to submit quiz" });
  }
});

// GET /training/scores
router.get("/scores", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(trainingScoresTable)
      .where(eq(trainingScoresTable.companyId, companyId))
      .orderBy(desc(trainingScoresTable.completedAt));
    return res.json(
      rows.map((r) => ({
        ...r,
        completedAt: r.completedAt.toISOString(),
      })),
    );
  } catch (err) {
    return res.status(500).json({ error: "Failed to list scores" });
  }
});

// GET /training/leaderboard
router.get("/leaderboard", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(trainingScoresTable)
      .where(eq(trainingScoresTable.companyId, companyId));
    const techMap: Record<
      string,
      { name: string; id: string | null; scores: number[]; passes: number }
    > = {};

    for (const r of rows) {
      if (!techMap[r.technicianName]) {
        techMap[r.technicianName] = {
          name: r.technicianName,
          id: r.technicianId,
          scores: [],
          passes: 0,
        };
      }
      techMap[r.technicianName].scores.push(r.score);
      if (r.passed) techMap[r.technicianName].passes++;
    }

    const entries = Object.values(techMap)
      .map((t) => {
        const avgScore = t.scores.reduce((a, b) => a + b, 0) / t.scores.length;
        const passRate = t.scores.length > 0 ? t.passes / t.scores.length : 0;
        let badge = "Trainee";
        if (avgScore >= 90) badge = "Gold";
        else if (avgScore >= 80) badge = "Silver";
        else if (avgScore >= 70) badge = "Bronze";
        else if (t.scores.length >= 3) badge = "Certified";
        return {
          technicianName: t.name,
          technicianId: t.id,
          avgScore: Math.round(avgScore * 10) / 10,
          totalQuizzes: t.scores.length,
          passRate: Math.round(passRate * 100) / 100,
          badge,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore);

    return res.json(entries.map((e, i) => ({ ...e, rank: i + 1 })));
  } catch (err) {
    return res.status(500).json({ error: "Failed to get leaderboard" });
  }
});

export default router;
