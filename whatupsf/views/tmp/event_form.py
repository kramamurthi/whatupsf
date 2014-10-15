def save_event(request):  
    form = BookForm
    if request.POST:
        form = BookForm(request.POST)
    if form.is_valid():
        form.save()
    return render_to_response('event_entry.html',{'form': form}, context_instance=RequestContext(request))
