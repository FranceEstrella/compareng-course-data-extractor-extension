"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ArrowLeft,
  RefreshCw,
  Plus,
  Trash,
  Download,
  AlertCircle,
  BookOpen,
  FileWarning,
  ExternalLink,
  Check,
} from "lucide-react"
import Link from "next/link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initialCourses, curriculumCodes } from "@/lib/course-data"
import { ThemeProvider } from "@/components/theme-provider"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import React from "react"

// Time slot constants
const DAYS = ["M", "T", "W", "Th", "F", "S"]
const TIME_SLOTS = [
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
]

// Course details map for quick lookup
const courseDetailsMap = initialCourses.reduce((map, course) => {
  map[course.code] = course
  return map
}, {})

// Interface for course data
interface CourseSection {
  courseCode: string
  section: string
  classSize: string
  remainingSlots: string
  meetingDays: string
  meetingTime: string
  room: string
  hasSlots: boolean
}

// Interface for active course from tracker
interface ActiveCourse {
  id: string
  code: string
  name: string
  credits: number
  status: string
}

// Interface for selected course with schedule info
interface SelectedCourse extends CourseSection {
  name: string
  credits: number
  timeStart: string
  timeEnd: string
  parsedDays: string[]
}

// Sample data for available courses - used as fallback
const sampleAvailableCourses = [
  {
    courseCode: "COE0001",
    section: "A",
    classSize: "40",
    remainingSlots: "15",
    meetingDays: "MW",
    meetingTime: "10:00:00-11:30:00",
    room: "Room 301",
    hasSlots: true,
  },
  {
    courseCode: "COE0003",
    section: "B",
    classSize: "35",
    remainingSlots: "5",
    meetingDays: "TTh",
    meetingTime: "13:00:00-14:30:00",
    room: "Room 201",
    hasSlots: true,
  },
  {
    courseCode: "GED0001",
    section: "C",
    classSize: "45",
    remainingSlots: "0",
    meetingDays: "F",
    meetingTime: "08:00:00-11:00:00",
    room: "Room 101",
    hasSlots: false,
  },
  {
    courseCode: "COE0005",
    section: "A",
    classSize: "30",
    remainingSlots: "10",
    meetingDays: "MW",
    meetingTime: "13:00:00-14:30:00",
    room: "Room 302",
    hasSlots: true,
  },
  {
    courseCode: "GED0004",
    section: "B",
    classSize: "35",
    remainingSlots: "8",
    meetingDays: "TTh",
    meetingTime: "08:00:00-09:30:00",
    room: "Room 202",
    hasSlots: true,
  },
]

// Extract department codes from course codes
const extractDepartmentCode = (courseCode: string): string => {
  const match = courseCode.match(/^[A-Z]+/)
  return match ? match[0] : "OTHER"
}

export default function ScheduleMaker() {
  const [availableCourses, setAvailableCourses] = useState<CourseSection[]>([])
  const [activeCourses, setActiveCourses] = useState<ActiveCourse[]>([])
  const [selectedCourses, setSelectedCourses] = useState<SelectedCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<"card" | "table">("card")
  const scheduleRef = useRef<HTMLDivElement>(null)
  const [showOnlyActive, setShowOnlyActive] = useState(true)
  const [startDate, setStartDate] = useState<Date>(new Date())
  const [isDownloading, setIsDownloading] = useState(false)

  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState("department")
  const [sortOrder, setSortOrder] = useState("asc")
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all")

  // Get all available department codes
  const departmentCodes = React.useMemo(() => {
    const departments = new Set<string>()
    availableCourses.forEach((course) => {
      const dept = extractDepartmentCode(course.courseCode)
      departments.add(dept)
    })
    return Array.from(departments).sort()
  }, [availableCourses])

  // Fetch available courses from the API
  const fetchAvailableCourses = async () => {
    try {
      console.log("Fetching available courses...")

      // Use fetch with explicit Accept header
      const response = await fetch("/api/get-available-courses", {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      })

      console.log("Response status:", response.status)
      console.log("Response headers:", Object.fromEntries(response.headers.entries()))

      // Check if response is ok before trying to parse JSON
      if (!response.ok) {
        const errorText = await response.text()
        console.error("API error response:", errorText)
        throw new Error(`API returned status: ${response.status}. Details: ${errorText}`)
      }

      // Check content type
      const contentType = response.headers.get("content-type")
      console.log("Content-Type:", contentType)

      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text()
        console.error("Non-JSON response:", text)
        throw new Error(`API did not return JSON. Content-Type: ${contentType || "undefined"}`)
      }

      // Parse JSON response
      const result = await response.json()
      console.log("API response parsed successfully:", result)

      if (result.success) {
        return result.data
      } else {
        throw new Error(result.error || "Failed to fetch available courses")
      }
    } catch (err: any) {
      console.error("Error fetching available courses:", err)
      throw new Error(`Error fetching available courses: ${err.message}`)
    }
  }

  // Load active courses from localStorage
  const loadActiveCourses = () => {
    try {
      if (typeof window !== "undefined") {
        const savedCourses = localStorage.getItem("courseStatuses")
        if (savedCourses) {
          const parsedCourses = JSON.parse(savedCourses)
          return parsedCourses.filter((course: any) => course.status === "active")
        }
      }
      return []
    } catch (err) {
      console.error("Error loading active courses from localStorage:", err)
      return []
    }
  }

  // Fetch both available courses and active courses
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Get available courses from API
      let availableCoursesData: CourseSection[] = []
      try {
        availableCoursesData = await fetchAvailableCourses()
        if (availableCoursesData.length === 0) {
          console.warn("No course data available, using sample data")
          availableCoursesData = sampleAvailableCourses
          setError("No course data available. Please use the extension to extract course data.")
        }
      } catch (err: any) {
        console.error("Failed to fetch available courses:", err)
        setError(err.message || "Failed to fetch available courses")
        availableCoursesData = sampleAvailableCourses
      }

      // Load active courses from localStorage
      const activeCoursesData = loadActiveCourses()

      setAvailableCourses(availableCoursesData)
      setActiveCourses(activeCoursesData)
      setLastUpdated(new Date())
    } catch (err: any) {
      setError("Error fetching data: " + (err.message || "Unknown error"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const fetchDataAndCheckFilter = async () => {
      await fetchData()

      // Check if there's a filtered course code from Academic Planner
      const filterCourseCode = localStorage.getItem("filterCourseCode")
      if (filterCourseCode) {
        setSearchTerm(filterCourseCode)
        // Clear the filter after using it
        localStorage.removeItem("filterCourseCode")
      }
    }

    fetchDataAndCheckFilter()
  }, [])

  // Filter courses based on active status and curriculum
  const filteredCourses = availableCourses.filter((course) => {
    if (showOnlyActive) {
      return (
        curriculumCodes.includes(course.courseCode) && activeCourses.some((active) => active.code === course.courseCode)
      )
    } else {
      return true // Show all courses when showOnlyActive is false
    }
  })

  // Find active courses that don't have available sections
  const coursesNeedingPetition = activeCourses.filter(
    (active) => !availableCourses.some((available) => available.courseCode === active.code),
  )

  // Clean and normalize time string
  const cleanTimeString = (timeString: string): string => {
    // Check if there are multiple identical times (e.g., "15:00:00-16:50:00 / 15:00:00-16:50:00")
    const times = timeString.split(" / ")

    // If all times are the same, just return one
    if (times.every((time) => time === times[0])) {
      // Format a single time (e.g., "15:00:00-16:50:00" to "15:00-16:50")
      const [start, end] = times[0].split("-")
      return `${start.substring(0, 5)}-${end.substring(0, 5)}`
    }

    // If times are different, format each one and join them
    return times
      .map((time) => {
        const [start, end] = time.split("-")
        return `${start.substring(0, 5)}-${end.substring(0, 5)}`
      })
      .join(" / ")
  }

  // Clean and normalize room string
  const cleanRoomString = (roomString: string): string => {
    // Check if there are multiple rooms (e.g., "E611 / E611")
    const rooms = roomString.split(" / ")

    // If all rooms are the same, just return one
    if (rooms.every((room) => room === rooms[0])) {
      return rooms[0]
    }

    // If rooms are different, return as is
    return roomString
  }

  // Parse time string (e.g., "10:00:00-11:30:00") into start and end times
  const parseTimeRange = (timeString: string): { start: string; end: string } => {
    const [start, end] = timeString.split("-")
    return {
      start: start.substring(0, 5), // Get HH:MM format
      end: end.substring(0, 5), // Get HH:MM format
    }
  }

  // Parse days string (e.g., "MW" or "TTh") into array of days
  const parseDays = (daysString: string): string[] => {
    if (!daysString) return []

    const days: string[] = []
    let i = 0

    while (i < daysString.length) {
      if (i < daysString.length - 1 && daysString.substring(i, i + 2) === "Th") {
        days.push("Th")
        i += 2
      } else {
        days.push(daysString[i])
        i += 1
      }
    }

    return days
  }

  // Convert day abbreviation to full day name
  const getFullDayName = (day: string): string => {
    switch (day) {
      case "M":
        return "Monday"
      case "T":
        return "Tuesday"
      case "W":
        return "Wednesday"
      case "Th":
        return "Thursday"
      case "F":
        return "Friday"
      case "S":
        return "Saturday"
      default:
        return day
    }
  }

  // Check if a course conflicts with already selected courses
  const hasScheduleConflict = (course: CourseSection): boolean => {
    if (!course.meetingTime || !course.meetingDays) return false

    const { start: newStart, end: newEnd } = parseTimeRange(course.meetingTime)
    const newDays = parseDays(course.meetingDays)

    return selectedCourses.some((selected) => {
      // Skip if it's the same course code (we'll handle replacement separately)
      if (selected.courseCode === course.courseCode) return false

      // Check if days overlap - only check for conflicts on the same days
      const daysOverlap = selected.parsedDays.some((day) => newDays.includes(day))
      if (!daysOverlap) return false // No conflict if on different days

      // Check if times overlap
      const timeOverlap =
        (newStart >= selected.timeStart && newStart < selected.timeEnd) ||
        (newEnd > selected.timeStart && newEnd <= selected.timeEnd) ||
        (newStart <= selected.timeStart && newEnd >= selected.timeEnd)

      return timeOverlap
    })
  }

  // Check if a course with the same code is already selected
  const hasSameCourseCode = (course: CourseSection): boolean => {
    return selectedCourses.some((selected) => selected.courseCode === course.courseCode)
  }

  // Get the selected course with the same code
  const getSelectedCourseWithSameCode = (course: CourseSection): SelectedCourse | undefined => {
    return selectedCourses.find((selected) => selected.courseCode === course.courseCode)
  }

  const sortCourses = (courses: CourseSection[]) => {
    return [...courses].sort((a, b) => {
      let valueA, valueB

      if (sortBy === "courseCode") {
        valueA = a.courseCode
        valueB = b.courseCode
      } else if (sortBy === "department") {
        // Extract department code (first 3-4 characters)
        valueA = extractDepartmentCode(a.courseCode)
        valueB = extractDepartmentCode(b.courseCode)

        // If departments are the same, sort by course code
        if (valueA === valueB) {
          valueA = a.courseCode
          valueB = b.courseCode
        }
      } else if (sortBy === "remainingSlots") {
        valueA = Number.parseInt(a.remainingSlots)
        valueB = Number.parseInt(b.remainingSlots)
      } else if (sortBy === "meetingDays") {
        valueA = a.meetingDays
        valueB = b.meetingDays
      } else {
        valueA = a[sortBy]
        valueB = b[sortBy]
      }

      if (sortOrder === "asc") {
        return valueA > valueB ? 1 : -1
      } else {
        return valueA < valueB ? 1 : -1
      }
    })
  }

  // Add a course to the selected courses
  const addCourse = (course: CourseSection) => {
    // Check if a course with the same code is already selected
    const existingCourse = selectedCourses.find((selected) => selected.courseCode === course.courseCode)

    if (existingCourse) {
      // Replace the existing course with the new one
      setSelectedCourses((prev) =>
        prev.map((selected) =>
          selected.courseCode === course.courseCode
            ? {
                ...course,
                name: courseDetailsMap[course.courseCode]?.name || "Unknown Course",
                credits: courseDetailsMap[course.courseCode]?.credits || 3,
                timeStart: parseTimeRange(course.meetingTime).start,
                timeEnd: parseTimeRange(course.meetingTime).end,
                parsedDays: parseDays(course.meetingDays),
              }
            : selected,
        ),
      )
      return
    }

    // Find the course details from active courses or courseDetailsMap
    const courseDetails = activeCourses.find((active) => active.code === course.courseCode) || {
      name: courseDetailsMap[course.courseCode]?.name || "Unknown Course",
      credits: courseDetailsMap[course.courseCode]?.credits || 3,
    }

    // Parse time and days
    const { start, end } = parseTimeRange(course.meetingTime)
    const parsedDays = parseDays(course.meetingDays)

    // Add to selected courses
    setSelectedCourses((prev) => [
      ...prev,
      {
        ...course,
        name: courseDetails.name,
        credits: courseDetails.credits,
        timeStart: start,
        timeEnd: end,
        parsedDays,
      },
    ])
  }

  // Remove a course from selected courses
  const removeCourse = (courseCode: string, section: string) => {
    setSelectedCourses((prev) =>
      prev.filter((course) => !(course.courseCode === courseCode && course.section === section)),
    )
  }

  // Replace the downloadSchedule function with this simpler version that doesn't use blob URLs
  const downloadSchedule = () => {
    if (selectedCourses.length === 0) {
      setError("No courses selected to download")
      return
    }

    try {
      setIsDownloading(true)

      // Create a simple text representation of the schedule
      let scheduleText = "MY CLASS SCHEDULE\n\n"

      // Group courses by day
      const coursesByDay = new Map<string, SelectedCourse[]>()

      selectedCourses.forEach((course) => {
        course.parsedDays.forEach((day) => {
          if (!coursesByDay.has(day)) {
            coursesByDay.set(day, [])
          }
          coursesByDay.get(day)?.push(course)
        })
      })

      // Sort days in order: M, T, W, Th, F, S
      const dayOrder = ["M", "T", "W", "Th", "F", "S"]
      const sortedDays = Array.from(coursesByDay.keys()).sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b))

      // Add each day's courses to the text
      sortedDays.forEach((day) => {
        const dayCourses = coursesByDay.get(day) || []

        // Sort courses by start time
        dayCourses.sort((a, b) => {
          return a.timeStart.localeCompare(b.timeStart)
        })

        scheduleText += `${getFullDayName(day)}:\n`
        scheduleText += "--------------------\n"

        dayCourses.forEach((course) => {
          scheduleText += `${course.courseCode} - ${course.name}\n`
          scheduleText += `Section: ${course.section}\n`
          scheduleText += `Time: ${course.timeStart}-${course.timeEnd}\n`
          scheduleText += `Room: ${course.room}\n`
          scheduleText += `Credits: ${course.credits}\n\n`
        })

        scheduleText += "\n"
      })

      // Create a download link for the text file
      const element = document.createElement("a")
      element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(scheduleText))
      element.setAttribute("download", "my-schedule.txt")

      // Simulate click to download
      element.style.display = "none"
      document.body.appendChild(element)
      element.click()
      document.body.removeChild(element)
    } catch (err) {
      console.error("Error generating schedule text:", err)
      setError("Failed to download schedule. Please try again.")
    } finally {
      setIsDownloading(false)
    }
  }

  // Add schedule to Google Calendar
  const addToGoogleCalendar = () => {
    if (selectedCourses.length === 0) return

    // Format the start date
    const formatDate = (date: Date): string => {
      return date.toISOString().replace(/-|:|\.\d+/g, "")
    }

    // Calculate the end date (12 weeks from start date)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 12 * 7) // 12 weeks

    // Create Google Calendar events for each course
    selectedCourses.forEach((course) => {
      course.parsedDays.forEach((day) => {
        // Map day to number (0 = Sunday, 1 = Monday, etc.)
        const dayMap = { M: 1, T: 2, W: 3, Th: 4, F: 5, S: 6 }
        const dayNum = dayMap[day]

        if (dayNum === undefined) return

        // Calculate first class date
        const firstClass = new Date(startDate)
        const currentDay = firstClass.getDay()
        const daysToAdd = (dayNum - currentDay + 7) % 7
        firstClass.setDate(firstClass.getDate() + daysToAdd)

        // Parse start and end times
        const [startHour, startMinute] = course.timeStart.split(":").map(Number)
        const [endHour, endMinute] = course.timeEnd.split(":").map(Number)

        // Set times for the event
        const eventStart = new Date(firstClass)
        eventStart.setHours(startHour, startMinute, 0)

        const eventEnd = new Date(firstClass)
        eventEnd.setHours(endHour, endMinute, 0)

        // Format dates for Google Calendar
        const startDateTime = formatDate(eventStart)
        const endDateTime = formatDate(eventEnd)

        // Create recurrence rule (weekly for 12 weeks)
        const recurrence = `RRULE:FREQ=WEEKLY;COUNT=12`

        // Create Google Calendar URL
        const calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${course.courseCode} - ${course.name}`)}&details=${encodeURIComponent(`Section: ${course.section}\nRoom: ${course.room}`)}&location=${encodeURIComponent(course.room)}&dates=${startDateTime}/${endDateTime}&recur=${encodeURIComponent(recurrence)}`

        // Open Google Calendar in a new tab
        window.open(calendarUrl, "_blank")
      })
    })
  }

  // Group courses by department
  const groupCoursesByDepartment = (courses: CourseSection[]) => {
    const grouped = courses.reduce(
      (acc, course) => {
        const dept = extractDepartmentCode(course.courseCode)
        if (!acc[dept]) acc[dept] = []
        acc[dept].push(course)
        return acc
      },
      {} as Record<string, CourseSection[]>,
    )

    // Sort departments
    return Object.entries(grouped)
      .sort(([deptA], [deptB]) => deptA.localeCompare(deptB))
      .map(([dept, courses]) => ({
        department: dept,
        courses: sortCourses(courses),
      }))
  }

  const getFilteredAndSortedCourses = () => {
    // First filter by search term and department
    const filtered = filteredCourses.filter((course) => {
      const matchesSearch =
        searchTerm === "" ||
        course.courseCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (courseDetailsMap[course.courseCode]?.name || "").toLowerCase().includes(searchTerm.toLowerCase())

      const matchesDepartment =
        selectedDepartment === "all" || extractDepartmentCode(course.courseCode) === selectedDepartment

      return matchesSearch && matchesDepartment
    })

    // Then sort
    return sortCourses(filtered)
  }

  // Open the student portal course offerings page
  const openStudentPortal = () => {
    window.open("https://solar.feutech.edu.ph/course/offerings", "_blank")
  }

  // Get the position and height for a course in the schedule grid
  const getCoursePosition = (course: SelectedCourse) => {
    const startParts = course.timeStart.split(":")
    const endParts = course.timeEnd.split(":")

    const startHour = Number.parseInt(startParts[0])
    const startMinute = Number.parseInt(startParts[1])
    const endHour = Number.parseInt(endParts[0])
    const endMinute = Number.parseInt(endParts[1])

    // Calculate start position (each hour is 60px, each minute is 1px)
    const startPosition = (startHour - 7) * 60 + startMinute

    // Calculate height (difference between end and start in minutes)
    const height = (endHour - startHour) * 60 + (endMinute - startMinute)

    return { top: startPosition, height }
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <Link href="/course-tracker">
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Back to Course Tracker
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold">Schedule Maker</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  Create your perfect class schedule with available course sections
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewMode(viewMode === "card" ? "table" : "card")}
                  className="flex items-center gap-2"
                >
                  {viewMode === "card" ? "Table View" : "Card View"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchData}
                  disabled={loading}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh Data
                </Button>
              </div>
            </div>
            {lastUpdated && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Last updated: {lastUpdated.toLocaleString()}
              </p>
            )}
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {error}
                <div className="mt-4">
                  <Button onClick={openStudentPortal} className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Open Student Portal Course Offerings
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Note about Course Tracker integration */}
          <Alert className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Course Tracker Integration</AlertTitle>
            <AlertDescription>
              The Schedule Maker shows available sections for courses marked as "Active" in the Course Tracker. If you
              don't see your desired courses, go back to the Course Tracker and mark them as active.
            </AlertDescription>
          </Alert>

          {/* Courses Needing Petition */}
          {coursesNeedingPetition.length > 0 && showOnlyActive && (
            <Alert className="mb-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300">
              <FileWarning className="h-4 w-4" />
              <AlertTitle>Courses Needing Petition</AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  The following active courses don't have available sections. You may need to file a petition for these
                  courses:
                </p>
                <div className="mt-2 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Course Code</TableHead>
                        <TableHead>Course Name</TableHead>
                        <TableHead>Credits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {coursesNeedingPetition.map((course) => (
                        <TableRow key={course.id}>
                          <TableCell className="font-medium">{course.code}</TableCell>
                          <TableCell>{course.name}</TableCell>
                          <TableCell>{course.credits}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="text-center py-10">
              <p className="text-gray-600 dark:text-gray-400">Loading available courses...</p>
            </div>
          ) : (
            <Tabs defaultValue="available" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="available">Available Courses</TabsTrigger>
                <TabsTrigger value="selected">Selected Courses ({selectedCourses.length})</TabsTrigger>
                <TabsTrigger value="schedule">Schedule View</TabsTrigger>
              </TabsList>

              {/* Available Courses Tab */}
              <TabsContent value="available">
                <div>
                  <div className="mb-4 flex flex-col md:flex-row gap-4 items-end">
                    <div className="w-full md:w-1/4">
                      <Label htmlFor="search-courses">Search Courses</Label>
                      <Input
                        id="search-courses"
                        placeholder="Search by code or name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <div className="w-full md:w-1/4">
                      <Label htmlFor="department-filter">Department</Label>
                      <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                        <SelectTrigger id="department-filter">
                          <SelectValue placeholder="Select department..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Departments</SelectItem>
                          {departmentCodes.map((dept) => (
                            <SelectItem key={dept} value={dept}>
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full md:w-1/4">
                      <Label htmlFor="sort-by">Sort By</Label>
                      <Select value={sortBy} onValueChange={setSortBy}>
                        <SelectTrigger id="sort-by">
                          <SelectValue placeholder="Sort by..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="department">Department</SelectItem>
                          <SelectItem value="courseCode">Course Code</SelectItem>
                          <SelectItem value="section">Section</SelectItem>
                          <SelectItem value="remainingSlots">Available Slots</SelectItem>
                          <SelectItem value="meetingDays">Meeting Days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full md:w-1/4">
                      <Label htmlFor="sort-order">Order</Label>
                      <Select value={sortOrder} onValueChange={setSortOrder}>
                        <SelectTrigger id="sort-order">
                          <SelectValue placeholder="Sort order..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">Ascending</SelectItem>
                          <SelectItem value="desc">Descending</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 mb-4">
                    <Switch id="show-active-only" checked={showOnlyActive} onCheckedChange={setShowOnlyActive} />
                    <Label htmlFor="show-active-only">Show only active courses from Course Tracker</Label>
                  </div>

                  <p className="mb-4">
                    Found {getFilteredAndSortedCourses().length} course sections
                    {showOnlyActive ? " for your active courses" : ""} (out of {availableCourses.length} total extracted
                    courses).
                  </p>

                  {getFilteredAndSortedCourses().length === 0 ? (
                    <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded mb-4">
                      <p>
                        No courses match your current filters. Try adjusting your search criteria or department filter.
                      </p>
                      {showOnlyActive && (
                        <div className="mt-4">
                          <Link href="/course-tracker">
                            <Button className="flex items-center gap-2">
                              <BookOpen className="h-4 w-4" />
                              Go to Course Tracker
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {viewMode === "table" && (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Department</TableHead>
                                <TableHead>Course Code</TableHead>
                                <TableHead>Course Name</TableHead>
                                <TableHead>Section</TableHead>
                                <TableHead>Schedule</TableHead>
                                <TableHead>Room</TableHead>
                                <TableHead>Slots</TableHead>
                                <TableHead>Action</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {groupCoursesByDepartment(getFilteredAndSortedCourses()).map(
                                ({ department, courses }) => (
                                  <React.Fragment key={department}>
                                    <TableRow className="bg-gray-100 dark:bg-gray-700">
                                      <TableCell colSpan={8} className="font-medium">
                                        Department: {department}
                                      </TableCell>
                                    </TableRow>
                                    {courses.map((course, index) => {
                                      const courseDetails = activeCourses.find(
                                        (active) => active.code === course.courseCode,
                                      ) || {
                                        name: courseDetailsMap[course.courseCode]?.name || "Unknown Course",
                                        credits: courseDetailsMap[course.courseCode]?.credits || 3,
                                      }
                                      const isConflict = hasScheduleConflict(course)
                                      const isAlreadySelected = selectedCourses.some(
                                        (selected) =>
                                          selected.courseCode === course.courseCode &&
                                          selected.section === course.section,
                                      )
                                      const hasSameCode = hasSameCourseCode(course) && !isAlreadySelected
                                      const existingCourse = hasSameCode ? getSelectedCourseWithSameCode(course) : null

                                      return (
                                        <TableRow key={`${course.courseCode}-${course.section}-${index}`}>
                                          <TableCell>{department}</TableCell>
                                          <TableCell>{course.courseCode}</TableCell>
                                          <TableCell>{courseDetails.name}</TableCell>
                                          <TableCell>{course.section}</TableCell>
                                          <TableCell>
                                            {cleanTimeString(course.meetingTime)} ({course.meetingDays})
                                          </TableCell>
                                          <TableCell>{cleanRoomString(course.room)}</TableCell>
                                          <TableCell>
                                            <Badge
                                              variant={course.hasSlots ? "success" : "destructive"}
                                              className={`px-2 py-1 text-xs font-semibold ${
                                                course.hasSlots
                                                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                              }`}
                                            >
                                              {course.hasSlots
                                                ? `${course.remainingSlots}/${course.classSize}`
                                                : "Full"}
                                            </Badge>
                                          </TableCell>
                                          <TableCell>
                                            {hasSameCode ? (
                                              <Popover>
                                                <PopoverTrigger asChild>
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100"
                                                  >
                                                    Replace Section
                                                  </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-80">
                                                  <div className="space-y-4">
                                                    <h4 className="font-medium">Replace Existing Section</h4>
                                                    <p className="text-sm">
                                                      You already have {course.courseCode} section{" "}
                                                      {existingCourse?.section} in your schedule. Do you want to replace
                                                      it with section {course.section}?
                                                    </p>
                                                    <div className="flex justify-end gap-2">
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => addCourse(course)}
                                                      >
                                                        <Check className="h-4 w-4 mr-1" /> Yes, Replace
                                                      </Button>
                                                    </div>
                                                  </div>
                                                </PopoverContent>
                                              </Popover>
                                            ) : (
                                              <Button
                                                size="sm"
                                                variant={
                                                  isAlreadySelected ? "destructive" : isConflict ? "outline" : "default"
                                                }
                                                disabled={isConflict && !isAlreadySelected}
                                                onClick={() => {
                                                  if (isAlreadySelected) {
                                                    removeCourse(course.courseCode, course.section)
                                                  } else {
                                                    addCourse(course)
                                                  }
                                                }}
                                              >
                                                {isAlreadySelected ? "Remove" : "Add"}
                                              </Button>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      )
                                    })}
                                  </React.Fragment>
                                ),
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {viewMode === "card" && (
                        <div className="space-y-6">
                          {groupCoursesByDepartment(getFilteredAndSortedCourses()).map(({ department, courses }) => (
                            <div key={department} className="border rounded-lg overflow-hidden">
                              <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 font-medium">
                                Department: {department}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                                {courses.map((course, index) => {
                                  const courseDetails = activeCourses.find(
                                    (active) => active.code === course.courseCode,
                                  ) || {
                                    name: courseDetailsMap[course.courseCode]?.name || "Unknown Course",
                                    credits: courseDetailsMap[course.courseCode]?.credits || 3,
                                  }
                                  const isConflict = hasScheduleConflict(course)
                                  const isAlreadySelected = selectedCourses.some(
                                    (selected) =>
                                      selected.courseCode === course.courseCode && selected.section === course.section,
                                  )
                                  const hasSameCode = hasSameCourseCode(course) && !isAlreadySelected
                                  const existingCourse = hasSameCode ? getSelectedCourseWithSameCode(course) : null

                                  return (
                                    <Card
                                      key={index}
                                      className={`bg-white dark:bg-gray-800 shadow-md transition-shadow ${
                                        isConflict ? "border-red-300 dark:border-red-700" : ""
                                      }`}
                                    >
                                      <CardHeader className="pb-2">
                                        <div className="flex justify-between items-start">
                                          <div>
                                            <p className="text-sm font-medium">{course.courseCode}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                              {courseDetails.name} - Section {course.section}
                                            </p>
                                          </div>
                                          <Badge
                                            variant={course.hasSlots ? "success" : "destructive"}
                                            className={`px-2 py-1 text-xs font-semibold ${
                                              course.hasSlots
                                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                                : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                            }`}
                                          >
                                            {course.hasSlots ? `${course.remainingSlots}/${course.classSize}` : "Full"}
                                          </Badge>
                                        </div>
                                      </CardHeader>
                                      <CardContent>
                                        <div className="space-y-2 text-sm">
                                          <div className="flex justify-between">
                                            <span className="font-medium">Days:</span>
                                            <span>{course.meetingDays}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="font-medium">Time:</span>
                                            <span>{cleanTimeString(course.meetingTime)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="font-medium">Room:</span>
                                            <span>{cleanRoomString(course.room)}</span>
                                          </div>
                                        </div>
                                      </CardContent>
                                      <CardFooter>
                                        {hasSameCode ? (
                                          <Popover>
                                            <PopoverTrigger asChild>
                                              <Button
                                                className="w-full"
                                                variant="outline"
                                                size="sm"
                                                className="bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100 w-full"
                                              >
                                                Replace Section
                                              </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-80">
                                              <div className="space-y-4">
                                                <h4 className="font-medium">Replace Existing Section</h4>
                                                <p className="text-sm">
                                                  You already have {course.courseCode} section {existingCourse?.section}{" "}
                                                  in your schedule. Do you want to replace it with section{" "}
                                                  {course.section}?
                                                </p>
                                                <div className="flex justify-end gap-2">
                                                  <Button size="sm" variant="outline" onClick={() => addCourse(course)}>
                                                    <Check className="h-4 w-4 mr-1" /> Yes, Replace
                                                  </Button>
                                                </div>
                                              </div>
                                            </PopoverContent>
                                          </Popover>
                                        ) : (
                                          <Button
                                            className="w-full"
                                            variant={
                                              isAlreadySelected ? "destructive" : isConflict ? "outline" : "default"
                                            }
                                            disabled={isConflict && !isAlreadySelected}
                                            onClick={() => {
                                              if (isAlreadySelected) {
                                                removeCourse(course.courseCode, course.section)
                                              } else {
                                                addCourse(course)
                                              }
                                            }}
                                          >
                                            {isAlreadySelected ? (
                                              <>
                                                <Trash className="h-4 w-4 mr-2" />
                                                Remove from Schedule
                                              </>
                                            ) : isConflict ? (
                                              <>
                                                <AlertCircle className="h-4 w-4 mr-2" />
                                                Conflicts
                                              </>
                                            ) : (
                                              <>
                                                <Plus className="h-4 w-4 mr-2" />
                                                Add to Schedule
                                              </>
                                            )}
                                          </Button>
                                        )}
                                      </CardFooter>
                                    </Card>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>

              {/* Selected Courses Tab */}
              <TabsContent value="selected">
                {selectedCourses.length === 0 ? (
                  <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-700 text-blue-700 dark:text-blue-400 px-4 py-3 rounded mb-4">
                    <p>No courses selected yet. Add courses from the Available Courses tab to build your schedule.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {selectedCourses.map((course, index) => (
                      <Card key={index} className="bg-white dark:bg-gray-800 shadow-md transition-shadow">
                        <CardHeader className="pb-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className="text-lg font-bold">{course.courseCode}</CardTitle>
                              <p className="text-sm font-medium">{course.name}</p>
                            </div>
                            <Badge
                              variant={course.hasSlots ? "success" : "destructive"}
                              className={`px-2 py-1 text-xs font-semibold ${
                                course.hasSlots
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              }`}
                            >
                              {course.hasSlots ? `${course.remainingSlots} slots` : "Full"}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Section: {course.section}</p>
                        </CardHeader>

                        <CardContent>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Days:</span>
                              <span>{course.meetingDays}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium">Time:</span>
                              <span>{cleanTimeString(course.meetingTime)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium">Room:</span>
                              <span>{cleanRoomString(course.room)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium">Class Size:</span>
                              <span>
                                {course.remainingSlots}/{course.classSize}
                              </span>
                            </div>
                          </div>
                        </CardContent>

                        <CardFooter>
                          <Button
                            className="w-full"
                            variant="destructive"
                            onClick={() => removeCourse(course.courseCode, course.section)}
                          >
                            <Trash className="h-4 w-4 mr-2" />
                            Remove from Schedule
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Schedule View Tab */}
              <TabsContent value="schedule">
                {selectedCourses.length === 0 ? (
                  <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-700 text-blue-700 dark:text-blue-400 px-4 py-3 rounded mb-4">
                    <p>No courses selected yet. Add courses from the Available Courses tab to build your schedule.</p>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 flex justify-between items-center">
                      <div className="flex items-center space-x-4">
                        <Label htmlFor="start-date">Start Date:</Label>
                        <Input
                          type="date"
                          id="start-date"
                          value={startDate.toISOString().split("T")[0]}
                          onChange={(e) => setStartDate(new Date(e.target.value))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={downloadSchedule}
                          disabled={isDownloading}
                          className="flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          {isDownloading ? "Downloading..." : "Download Schedule"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={addToGoogleCalendar}>
                          Add to Google Calendar
                        </Button>
                      </div>
                    </div>

                    <div ref={scheduleRef} className="overflow-x-auto">
                      <div className="relative w-[900px] h-[1440px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md">
                        {/* Time Slots */}
                        {TIME_SLOTS.map((time, index) => (
                          <div
                            key={time}
                            className="absolute left-0 w-full border-b border-gray-200 dark:border-gray-700"
                            style={{ top: index * 30 + 60 + "px", height: "30px" }}
                          >
                            <div className="absolute left-2 -translate-x-full -mt-2 text-xs text-gray-500 dark:text-gray-400">
                              {time}
                            </div>
                          </div>
                        ))}

                        {/* Days of the Week */}
                        {DAYS.map((day, index) => (
                          <div
                            key={day}
                            className="absolute top-0 w-[148px] h-full border-r border-gray-200 dark:border-gray-700"
                            style={{ left: index * 148 + 76 + "px" }}
                          >
                            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700 dark:text-gray-300">
                              {day}
                            </div>
                          </div>
                        ))}

                        {/* Courses in Schedule */}
                        {selectedCourses.map((course, index) => {
                          const { top, height } = getCoursePosition(course)

                          return course.parsedDays
                            .map((day, dayIndex) => {
                              const dayPosition = DAYS.indexOf(day)
                              if (dayPosition === -1) return null

                              return (
                                <div
                                  key={`${index}-${dayIndex}`}
                                  className="absolute bg-blue-500 dark:bg-blue-600 text-white text-xs font-medium rounded-md p-2 overflow-hidden"
                                  style={{
                                    top: top + 60 + "px",
                                    left: dayPosition * 148 + 84 + "px",
                                    width: "132px",
                                    height: height + "px",
                                  }}
                                >
                                  <p className="truncate">{course.courseCode}</p>
                                  <p className="truncate">{course.name}</p>
                                  <p className="text-xxs">
                                    {course.timeStart} - {course.timeEnd}
                                  </p>
                                  <p className="text-xxs">{course.room}</p>
                                </div>
                              )
                            })
                            .filter(Boolean)
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </ThemeProvider>
  )
}
