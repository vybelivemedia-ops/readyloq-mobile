import { Seo } from "@/components/seo";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { submitLead } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";

const demoSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone is required"),
  companyName: z.string().min(1, "Company is required"),
  role: z.string().min(1, "Role is required"),
  teamSize: z.string().min(1, "Team size is required"),
  message: z.string().optional(),
});

export default function Demo() {
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<z.infer<typeof demoSchema>>({
    resolver: zodResolver(demoSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      companyName: "",
      role: "",
      teamSize: "",
      message: "",
    },
  });

  async function onSubmit(values: z.infer<typeof demoSchema>) {
    try {
      await submitLead({
        type: "demo",
        ...values,
        source: "/demo",
      });
      setIsSubmitted(true);
    } catch (error) {
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <Seo 
        title="Request a Demo | ReadyLoq" 
        description="Schedule a demo to see how ReadyLoq can secure your operational knowledge and reduce callbacks."
      />
      
      <div className="flex-1 bg-slate-50 py-12 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-24">
            
            {/* Left Col - Copy */}
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">See ReadyLoq in action.</h1>
              <p className="text-xl text-slate-600 mb-8">
                Learn how to capture technician expertise, standardize route handoffs, and generate professional white-labeled reports.
              </p>
              
              <div className="space-y-6">
                {[
                  "Live walkthrough of the mobile app",
                  "Demonstration of property intelligence records",
                  "Review of white-labeled reporting capabilities",
                  "Discussion of your specific operational challenges"
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="text-primary mt-1" size={24} />
                    <span className="text-lg text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Col - Form */}
            <div>
              <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-200">
                {isSubmitted ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CheckCircle2 size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-4">Request Received</h2>
                    <p className="text-slate-600 mb-8">
                      Thank you for your interest. We'll be in touch shortly to schedule your demonstration.
                    </p>
                    <Button onClick={() => setIsSubmitted(false)} variant="outline">
                      Submit another request
                    </Button>
                  </div>
                ) : (
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full Name *</FormLabel>
                              <FormControl>
                                <Input placeholder="Jane Doe" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Work Email *</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="jane@company.com" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="companyName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Company Name *</FormLabel>
                              <FormControl>
                                <Input placeholder="Acme Pest Control" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone Number *</FormLabel>
                              <FormControl>
                                <Input type="tel" placeholder="(555) 123-4567" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="role"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Role *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select role" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="owner">Owner / CEO</SelectItem>
                                  <SelectItem value="operations_manager">Operations Manager</SelectItem>
                                  <SelectItem value="branch_manager">Branch Manager</SelectItem>
                                  <SelectItem value="training_manager">Training Manager</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="teamSize"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Technician Count *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select size" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="1-5">1-5</SelectItem>
                                  <SelectItem value="6-20">6-20</SelectItem>
                                  <SelectItem value="21-50">21-50</SelectItem>
                                  <SelectItem value="50+">50+</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>What challenges are you trying to solve?</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Tell us a bit about your current operations..." 
                                className="resize-none" 
                                rows={3}
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button type="submit" className="w-full text-lg" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? "Submitting..." : "Request Demo"}
                      </Button>
                    </form>
                  </Form>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
