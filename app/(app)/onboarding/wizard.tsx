"use client"

import { useState } from "react"
import { Progress } from "@/components/ui/progress"
import Step1 from "./steps/step1"
import Step2 from "./steps/step2"
import Step3 from "./steps/step3"
import Step4 from "./steps/step4"
import Step5 from "./steps/step5"
import Step6 from "./steps/step6"
import Step7 from "./steps/step7"
import Step8 from "./steps/step8"
import Step9 from "./steps/step9"
import Step10 from "./steps/step10"
import type { WizardData } from "./types"

const STEP_TITLES = [
  "Basics",
  "Business description",
  "Revenue profile",
  "Home office",
  "Vehicle",
  "Inventory",
  "Business trips",
  "Known people & patterns",
  "Expected income sources",
  "Review & confirm",
]

type Props = {
  initialStep: number
  initialData: Partial<WizardData>
}

export default function Wizard({ initialStep, initialData }: Props) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), 10))
  const [data, setData] = useState<Partial<WizardData>>(initialData)

  const handleNext = (stepData: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...stepData }))
    setStep((s) => Math.min(s + 1, 10))
  }

  const handleBack = () => setStep((s) => Math.max(s - 1, 1))

  const handleJumpToStep = (target: number) => setStep(target)

  const progress = ((step - 1) / 9) * 100

  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Step {step} of 10
          </p>
          <p className="text-xs text-muted-foreground">{STEP_TITLES[step - 1]}</p>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Step title */}
      <h2 className="text-xl font-semibold text-foreground mb-4">{STEP_TITLES[step - 1]}</h2>

      {/* Step content */}
      {step === 1 && <Step1 data={data} onNext={handleNext} />}
      {step === 2 && <Step2 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 3 && <Step3 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 4 && <Step4 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 5 && <Step5 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 6 && <Step6 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 7 && <Step7 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 8 && <Step8 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 9 && <Step9 data={data} onNext={handleNext} onBack={handleBack} />}
      {step === 10 && <Step10 data={data} onBack={handleBack} onJumpToStep={handleJumpToStep} />}
    </div>
  )
}
