import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Button, Modal, TextInput, Select, Text, Group, ActionIcon, Tooltip } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { IconTrash, IconCalendarPlus, IconDownload } from '@tabler/icons-react';

const localizer = momentLocalizer(moment);

interface Event {
  id: string;
  title: string;
  start: Date;
  end: Date;
  subject: string;
  color?: string;
}

const ScheduleMaker = () => {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const colors = [
    '#FF6B6B', '#4ECDC4', '#45A7E6', '#A37EBD', '#F9A03F',
    '#6BFF6B', '#E645A7', '#7EBD7E', '#A03FF9', '#FFD166'
  ];

  useEffect(() => {
    const savedEvents = localStorage.getItem('scheduleEvents');
    const savedSubjects = localStorage.getItem('scheduleSubjects');
    
    if (savedEvents) setEvents(JSON.parse(savedEvents));
    if (savedSubjects) setSubjects(JSON.parse(savedSubjects));
  }, []);

  useEffect(() => {
    localStorage.setItem('scheduleEvents', JSON.stringify(events));
    localStorage.setItem('scheduleSubjects', JSON.stringify(subjects));
  }, [events, subjects]);

  const handleSelectSlot = (slotInfo: { start: Date; end: Date; action: 'select' }) => {
    setSelectedEvent(null);
    setEventTitle('');
    setStartTime(moment(slotInfo.start).format('HH:mm'));
    setEndTime(moment(slotInfo.end).format('HH:mm'));
    setIsModalOpen(true);
  };

  const handleSelectEvent = (event: Event) => {
    setSelectedEvent(event);
    setEventTitle(event.title);
    setSelectedSubject(event.subject);
    setStartTime(moment(event.start).format('HH:mm'));
    setEndTime(moment(event.end).format('HH:mm'));
    setIsModalOpen(true);
  };

  const addSubject = () => {
    if (newSubject.trim() && !subjects.includes(newSubject.trim())) {
      setSubjects([...subjects, newSubject.trim()]);
      setNewSubject('');
    }
    setIsSubjectModalOpen(false);
  };

  const deleteSubject = (subject: string) => {
    const updatedSubjects = subjects.filter(s => s !== subject);
    setSubjects(updatedSubjects);
    const updatedEvents = events.filter(e => e.subject !== subject);
    setEvents(updatedEvents);
  };

  const saveEvent = () => {
    if (!selectedSubject || !eventTitle || !startTime || !endTime) return;

    const start = new Date();
    const end = new Date();

    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    start.setHours(startHours, startMinutes, 0, 0);
    end.setHours(endHours, endMinutes, 0, 0);

    const subjectColor = colors[subjects.indexOf(selectedSubject) % colors.length];

    if (selectedEvent) {
      const updatedEvents = events.map(e => 
        e.id === selectedEvent.id 
          ? { 
              ...e, 
              title: eventTitle, 
              subject: selectedSubject,
              start,
              end,
              color: subjectColor
            } 
          : e
      );
      setEvents(updatedEvents);
    } else {
      const newEvent: Event = {
        id: Date.now().toString(),
        title: eventTitle,
        subject: selectedSubject,
        start,
        end,
        color: subjectColor
      };
      setEvents([...events, newEvent]);
    }

    setIsModalOpen(false);
  };

  const deleteEvent = () => {
    if (selectedEvent) {
      setEvents(events.filter(e => e.id !== selectedEvent.id));
      setIsModalOpen(false);
    }
  };

  const addToGoogleCalendar = () => {
    if (events.length === 0) return;

    const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    let datesParam = '';
    let detailsParam = '';

    // Create events for each subject
    events.forEach((event, index) => {
      const startDate = moment(event.start).format('YYYYMMDDTHHmmss');
      const endDate = moment(event.end).format('YYYYMMDDTHHmmss');
      
      if (index === 0) {
        datesParam = `&dates=${startDate}/${endDate}`;
        detailsParam = `&text=${encodeURIComponent(event.title)}&details=${encodeURIComponent(event.subject)}`;
      } else {
        // For multiple events, we can only link to the first one
        // Google Calendar doesn't support multiple events in one URL
        // So we'll just add details about the other events in the description
        detailsParam += `%0A%0A${encodeURIComponent(event.title)}: ${encodeURIComponent(event.subject)} (${moment(event.start).format('h:mm A')} - ${moment(event.end).format('h:mm A')})`;
      }
    });

    window.open(`${baseUrl}${datesParam}${detailsParam}&sf=true&output=xml`, '_blank');
  };

  const downloadICS = () => {
    if (events.length === 0) return;

    let icsContent = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Schedule Maker//EN\n';

    events.forEach(event => {
      const start = moment(event.start).utc().format('YYYYMMDDTHHmmss[Z]');
      const end = moment(event.end).utc().format('YYYYMMDDTHHmmss[Z]');
      
      icsContent += `BEGIN:VEVENT\n`;
      icsContent += `UID:${event.id}\n`;
      icsContent += `DTSTAMP:${moment().utc().format('YYYYMMDDTHHmmss[Z]')}\n`;
      icsContent += `DTSTART:${start}\n`;
      icsContent += `DTEND:${end}\n`;
      icsContent += `SUMMARY:${event.title}\n`;
      icsContent += `DESCRIPTION:${event.subject}\n`;
      icsContent += `END:VEVENT\n`;
    });

    icsContent += 'END:VCALENDAR';

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'schedule.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const eventStyleGetter = (event: Event) => {
    return {
      style: {
        backgroundColor: event.color || '#3174ad',
        borderRadius: '4px',
        opacity: 0.8,
        color: 'white',
        border: '0px',
        display: 'block'
      }
    };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>Schedule Maker</title>
      </Head>

      <main className="container mx-auto py-8 px-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">Schedule Maker</h1>
          <div className="flex space-x-2">
            <Button 
              leftIcon={<IconCalendarPlus size={16} />} 
              onClick={addToGoogleCalendar}
              disabled={events.length === 0}
            >
              Add to Google Calendar
            </Button>
            <Button 
              leftIcon={<IconDownload size={16} />} 
              variant="outline"
              onClick={downloadICS}
              disabled={events.length === 0}
            >
              Download .ics
            </Button>
            <Button onClick={() => setIsSubjectModalOpen(true)}>
              Manage Subjects
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 700 }}
            selectable
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            defaultView="week"
            views={['week', 'day']}
            min={new Date(0, 0, 0, 7, 0, 0)}
            max={new Date(0, 0, 0, 22, 0, 0)}
            eventPropGetter={eventStyleGetter}
          />
        </div>

        {/* Event Modal */}
        <Modal
          opened={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={selectedEvent ? 'Edit Event' : 'Add Event'}
          size="sm"
        >
          <div className="space-y-4">
            <TextInput
              label="Event Title"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.currentTarget.value)}
              placeholder="e.g. Lecture, Lab"
            />

            <Select
              label="Subject"
              placeholder="Select subject"
              value={selectedSubject}
              onChange={(value) => setSelectedSubject(value || '')}
              data={subjects.map(subject => ({ value: subject, label: subject }))}
              required
            />

            <TimeInput
              label="Start Time"
              value={startTime}
              onChange={(e) => setStartTime(e.currentTarget.value)}
              format="24"
              required
            />

            <TimeInput
              label="End Time"
              value={endTime}
              onChange={(e) => setEndTime(e.currentTarget.value)}
              format="24"
              required
            />

            <Group position="apart" mt="md">
              {selectedEvent && (
                <Button color="red" onClick={deleteEvent}>
                  Delete
                </Button>
              )}
              <Group position="right">
                <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveEvent}>
                  Save
                </Button>
              </Group>
            </Group>
          </div>
        </Modal>

        {/* Subject Modal */}
        <Modal
          opened={isSubjectModalOpen}
          onClose={() => setIsSubjectModalOpen(false)}
          title="Manage Subjects"
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex space-x-2">
              <TextInput
                value={newSubject}
                onChange={(e) => setNewSubject(e.currentTarget.value)}
                placeholder="New subject name"
                className="flex-grow"
              />
              <Button onClick={addSubject}>
                Add
              </Button>
            </div>

            <div className="space-y-2">
              {subjects.map((subject, index) => (
                <div key={subject} className="flex justify-between items-center p-2 bg-gray-100 rounded">
                  <div className="flex items-center">
                    <div 
                      className="w-4 h-4 rounded-full mr-2" 
                      style={{ backgroundColor: colors[index % colors.length] }}
                    />
                    <Text>{subject}</Text>
                  </div>
                  <Tooltip label="Delete subject" withArrow position="right">
                    <ActionIcon color="red" onClick={() => deleteSubject(subject)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      </main>
    </div>
  );
};

export default ScheduleMaker;

