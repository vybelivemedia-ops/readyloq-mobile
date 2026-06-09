import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetQuiz, useSubmitQuiz } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle2, XCircle, Trophy, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

type QuizState = "intro" | "quiz" | "result";

export default function QuizPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: quiz, isLoading } = useGetQuiz(id, { query: { enabled: !!id } });
  const submitQuiz = useSubmitQuiz();

  const [quizState, setQuizState] = useState<QuizState>("intro");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);

  if (isLoading) return (
    <div className="max-w-xl mx-auto space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );

  if (!quiz) return <div className="text-center py-16 text-muted-foreground">Quiz not found.</div>;

  const questions = quiz.questions ?? [];

  if (quizState === "intro") {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/training"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-xl font-bold">{quiz.title}</h1>
        </div>
        <Card className="bg-card">
          <CardContent className="pt-6 space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Trophy className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{quiz.title}</h2>
              {quiz.description && <p className="text-sm text-muted-foreground mt-1">{quiz.description}</p>}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="font-bold text-lg">{quiz.questionCount}</p>
                <p className="text-xs text-muted-foreground">Questions</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="font-bold text-lg">{quiz.passingScore}%</p>
                <p className="text-xs text-muted-foreground">Pass Score</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="font-bold text-lg capitalize">{quiz.difficulty}</p>
                <p className="text-xs text-muted-foreground">Difficulty</p>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={() => setQuizState("quiz")} disabled={questions.length === 0}>
              Start Quiz
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (quizState === "result" && result) {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <h1 className="text-xl font-bold">Quiz Results</h1>
        <Card className={`${result.passed ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          <CardContent className="pt-6 text-center space-y-3">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${result.passed ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
              {result.passed ? <CheckCircle2 className="h-8 w-8 text-emerald-400" /> : <XCircle className="h-8 w-8 text-red-400" />}
            </div>
            <div>
              <p className="text-3xl font-bold">{result.score}%</p>
              <p className={`text-sm font-semibold mt-1 ${result.passed ? "text-emerald-400" : "text-red-400"}`}>
                {result.passed ? "PASSED" : "FAILED"}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {result.correctAnswers} of {result.totalQuestions} correct
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {questions.map((q: any, i: number) => {
            const feedback = result.feedback?.find((f: any) => f.questionId === q.id);
            return (
              <Card key={q.id} className={`${feedback?.correct ? "border-emerald-500/20" : "border-red-500/20"}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      {feedback?.correct
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        : <XCircle className="h-4 w-4 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Q{i + 1}: {q.question}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Correct: <span className="text-foreground">{q.options[q.correctOption]}</span>
                      </p>
                      {feedback?.explanation && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{feedback.explanation}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => {
            setQuizState("intro");
            setCurrentQ(0);
            setAnswers({});
            setSelectedOption(null);
            setResult(null);
          }}>Retake Quiz</Button>
          <Link href="/training" className="flex-1">
            <Button className="w-full">Back to Training</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Quiz in progress
  const question = questions[currentQ];
  const total = questions.length;
  const progress = ((currentQ) / total) * 100;
  const isLastQ = currentQ === total - 1;

  const handleNext = async () => {
    if (selectedOption === null) return;
    const newAnswers = { ...answers, [question.id]: selectedOption };
    setAnswers(newAnswers);

    if (isLastQ) {
      try {
        const answerPayload = Object.entries(newAnswers).map(([qId, opt]) => ({
          questionId: parseInt(qId),
          selectedOption: opt,
        }));
        const res = await submitQuiz.mutateAsync({ id, data: { answers: answerPayload } });
        setResult(res);
        setQuizState("result");
      } catch {
        toast({ title: "Error", description: "Failed to submit quiz.", variant: "destructive" });
      }
    } else {
      setCurrentQ(q => q + 1);
      setSelectedOption(null);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/training"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{quiz.title}</span>
            <span className="text-xs font-medium">{currentQ + 1} / {total}</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      </div>

      <div className="aspect-video rounded-lg overflow-hidden bg-muted">
        <img src={question.imageUrl} alt="Inspection photo" className="w-full h-full object-cover" />
      </div>

      <Card className="bg-card">
        <CardContent className="pt-5 pb-4">
          <p className="text-base font-semibold mb-4">{question.question}</p>
          <div className="space-y-2">
            {question.options.map((opt: string, i: number) => (
              <button
                key={i}
                onClick={() => setSelectedOption(i)}
                className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                  selectedOption === i
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border bg-transparent text-foreground hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 text-xs font-bold ${
                    selectedOption === i ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}>{String.fromCharCode(65 + i)}</span>
                  {opt}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        size="lg"
        disabled={selectedOption === null || submitQuiz.isPending}
        onClick={handleNext}
      >
        {isLastQ ? (submitQuiz.isPending ? "Submitting..." : "Submit Quiz") : "Next Question"}
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
